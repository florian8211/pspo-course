#!/usr/bin/env python3
"""Self-hosting server for the PSPO course.

Serves index.html with a small runtime (runtime.js) injected, and backs that
runtime with two APIs: /api/sample (model calls via the claude CLI, streamed as
NDJSON) and /api/db (one JSON document per path on disk).

Standard library only. Configure with PSPO_* environment variables, see README.
This spends the operator's model quota: only expose it on a private network.
"""

import json
import logging
import os
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

PORT = int(os.environ.get("PSPO_PORT", "3140"))
BIND = os.environ.get("PSPO_BIND", "127.0.0.1")
DATA_DIR = Path(os.environ.get("PSPO_DATA_DIR") or "~/.local/share/pspo-course").expanduser()
CLAUDE_MODEL = os.environ.get("PSPO_CLAUDE_MODEL", "sonnet")
TIMEOUT = float(os.environ.get("PSPO_TIMEOUT", "180"))
MAX_CONCURRENT = int(os.environ.get("PSPO_MAX_CONCURRENT", "2"))

SYSTEM_PROMPT = "You are a precise Scrum tutor for the PSPO I exam."
MAX_PROMPT_CHARS = 60_000
MAX_DB_BYTES = 2 * 1024 * 1024
DB_PATH_RE = re.compile(r"^[a-z0-9_-]+/[a-z0-9_-]+$")
RUNTIME_TAG = b'<script src="/runtime.js"></script>'

log = logging.getLogger("pspo")
slots = threading.BoundedSemaphore(MAX_CONCURRENT)


def model_command():
    custom = os.environ.get("PSPO_MODEL_CMD")
    if custom:
        return shlex.split(custom)
    return [
        "claude", "-p", "--model", CLAUDE_MODEL, "--system-prompt", SYSTEM_PROMPT,
        "--tools", "", "--strict-mcp-config", "--setting-sources", "",
        "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    ]


def inject_runtime(html: bytes) -> bytes:
    """Put the runtime script tag before every other script in the page."""
    m = re.search(rb"<head(\s[^>]*)?>", html, re.IGNORECASE)
    if not m:
        # No explicit <head>: go right after a leading doctype/<html>, else at the very start.
        m = re.match(rb"\s*(<!doctype[^>]*>\s*)?(<html[^>]*>)?", html, re.IGNORECASE)
    return html[: m.end()] + RUNTIME_TAG + html[m.end():]


def db_file(path: str) -> Path:
    return DATA_DIR / (path.replace("/", "__") + ".json")


def write_atomic(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


class ClientGone(Exception):
    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "pspo-course"

    # -- helpers ---------------------------------------------------------

    def send_body(self, status, body: bytes, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, obj):
        self.send_body(status, json.dumps(obj).encode(), "application/json")

    def send_file(self, path: Path, ctype):
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            return self.send_json(404, {"error": "not found"})
        self.send_body(200, data, ctype)

    def read_body(self, limit):
        """Return the raw body, or None after answering 413 when it exceeds limit."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0:
            self.close_connection = True
            self.send_json(400, {"error": "bad content-length"})
            return None
        if length > limit:
            self.close_connection = True
            self.send_json(413, {"error": "body too large"})
            return None
        return self.rfile.read(length)

    def route(self):
        url = urlsplit(self.path)
        return url.path, parse_qs(url.query)

    # -- GET -------------------------------------------------------------

    def do_GET(self):
        path, query = self.route()
        if path in ("/", "/index.html"):
            try:
                html = (REPO / "index.html").read_bytes()
            except FileNotFoundError:
                return self.send_json(404, {"error": "not found"})
            self.send_body(200, inject_runtime(html), "text/html; charset=utf-8",
                           {"Cache-Control": "no-store"})
        elif path == "/runtime.js":
            self.send_file(HERE / "runtime.js", "application/javascript; charset=utf-8")
        elif path == "/og-image.png":
            self.send_file(REPO / "og-image.png", "image/png")
        elif path == "/api/health":
            self.send_json(200, {"ok": True})
        elif path == "/api/db":
            self.db_get(query)
        else:
            self.send_json(404, {"error": "not found"})

    # -- POST / PUT ------------------------------------------------------

    def do_POST(self):
        path, _ = self.route()
        if path == "/api/sample":
            self.sample()
        else:
            self.send_json(404, {"error": "not found"})

    def do_PUT(self):
        path, query = self.route()
        if path == "/api/db":
            self.db_put(query)
        else:
            self.send_json(404, {"error": "not found"})

    # -- /api/db ---------------------------------------------------------

    def db_path(self, query):
        p = (query.get("path") or [""])[0]
        if not DB_PATH_RE.match(p):
            self.send_json(400, {"error": "invalid path"})
            return None
        return p

    def db_get(self, query):
        p = self.db_path(query)
        if p is None:
            return
        try:
            data = json.loads(db_file(p).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return self.send_json(200, {"exists": False, "data": None})
        except (OSError, ValueError):
            log.exception("db read failed for %s", p)
            return self.send_json(500, {"error": "unreadable document"})
        self.send_json(200, {"exists": True, "data": data})

    def db_put(self, query):
        p = self.db_path(query)
        if p is None:
            return
        raw = self.read_body(MAX_DB_BYTES)
        if raw is None:
            return
        try:
            obj = json.loads(raw)
        except ValueError:
            return self.send_json(400, {"error": "invalid json"})
        if not isinstance(obj, dict):
            return self.send_json(400, {"error": "body must be a JSON object"})
        write_atomic(db_file(p), json.dumps(obj, ensure_ascii=False).encode("utf-8"))
        self.send_json(200, {"ok": True})

    # -- /api/sample -----------------------------------------------------

    def sample(self):
        # Content-Length is bytes; allow for multi-byte characters, then check chars.
        raw = self.read_body(MAX_PROMPT_CHARS * 4)
        if raw is None:
            return
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            return self.send_json(400, {"error": "body must be utf-8"})
        if len(text) > MAX_PROMPT_CHARS:
            return self.send_json(413, {"error": "body too large"})
        try:
            body = json.loads(text)
        except ValueError:
            return self.send_json(400, {"error": "invalid json"})
        prompt = body.get("prompt") if isinstance(body, dict) else None
        if not isinstance(prompt, str) or not prompt.strip():
            return self.send_json(400, {"error": "prompt required"})
        if len(prompt) > MAX_PROMPT_CHARS:
            return self.send_json(413, {"error": "prompt too large"})

        if not slots.acquire(blocking=False):
            return self.send_json(429, {"code": "rate_limited"})
        try:
            log.info("sample: prompt %d chars, tier %s", len(prompt), body.get("modelTier"))
            self.run_model(prompt)
        finally:
            slots.release()

    def emit(self, obj):
        try:
            self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8") + b"\n")
            self.wfile.flush()
        except OSError as e:
            raise ClientGone() from e

    def run_model(self, prompt):
        self.close_connection = True  # the stream ends when the connection closes
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            error = self.stream_model(prompt)
        except ClientGone:
            log.info("sample: client disconnected")
            return
        if error:
            log.warning("sample failed: %s", error)
            try:
                self.emit({"error": error})
            except ClientGone:
                pass

    def stream_model(self, prompt):
        """Stream deltas to the client. Returns an error message, or None after sending done."""
        with tempfile.TemporaryDirectory(prefix="pspo-sample-") as cwd:
            stderr_path = Path(cwd) / ".stderr"
            with open(stderr_path, "wb") as stderr:
                try:
                    proc = subprocess.Popen(
                        model_command(), cwd=cwd, stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=stderr, start_new_session=True,
                    )
                except OSError as e:
                    return f"model command could not start ({e.strerror or e})"

            timed_out = threading.Event()

            def kill():
                timed_out.set()
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass

            timer = threading.Timer(TIMEOUT, kill)
            timer.daemon = True
            timer.start()
            try:
                try:
                    proc.stdin.write(prompt.encode("utf-8"))
                    proc.stdin.close()
                except BrokenPipeError:
                    pass

                streamed = []
                result = None
                for line in proc.stdout:
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("type") == "stream_event":
                        event = msg.get("event") or {}
                        delta = event.get("delta") or {}
                        if (event.get("type") == "content_block_delta"
                                and delta.get("type") == "text_delta" and delta.get("text")):
                            streamed.append(delta["text"])
                            self.emit({"t": delta["text"]})
                    elif msg.get("type") == "result":
                        result = msg
                code = proc.wait()
            except BaseException:
                kill()
                proc.wait()
                raise
            finally:
                timer.cancel()
                proc.stdout.close()

            if timed_out.is_set():
                return f"model timed out after {TIMEOUT:g}s"
            if code != 0 or (result and result.get("is_error")):
                tail = stderr_path.read_text(errors="replace").strip()[-300:]
                if tail:
                    log.warning("model stderr: %s", tail)
                return f"model call failed (exit {code})"

        text = "".join(streamed)
        final = result.get("result") if result else None
        if not text and isinstance(final, str) and final:
            text = final
            self.emit({"t": text})
        if not text:
            return "model returned no text"
        self.emit({"done": True, "text": text})
        return None

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        stream=sys.stderr)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    server.daemon_threads = True
    log.info("serving on http://%s:%d (data %s, max %d concurrent)", BIND, PORT, DATA_DIR, MAX_CONCURRENT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
