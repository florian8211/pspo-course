"""End-to-end tests for server/serve.py, run against a real subprocess with a fake model."""

import http.client
import json
import os
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
SERVER = TESTS.parent
REPO = SERVER.parent
RUNTIME_TAG = '<script src="runtime.js"></script>'


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data_dir = tempfile.TemporaryDirectory()
        cls.port = free_port()
        env = dict(os.environ)
        env.update({
            "PSPO_PORT": str(cls.port),
            "PSPO_BIND": "127.0.0.1",
            "PSPO_DATA_DIR": cls.data_dir.name,
            "PSPO_MODEL_CMD": shlex.join([sys.executable, str(TESTS / "fake_model.py")]),
            "PSPO_MAX_CONCURRENT": "1",
            "PSPO_TIMEOUT": "20",
        })
        cls.proc = subprocess.Popen([sys.executable, str(SERVER / "serve.py")], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 10
        while True:
            try:
                status, body = cls.request("GET", "/api/health")
                if status == 200 and json.loads(body) == {"ok": True}:
                    break
            except OSError:
                pass
            if time.time() > deadline or cls.proc.poll() is not None:
                cls.tearDownClass()
                raise RuntimeError("serve.py did not become healthy")
            time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
        cls.data_dir.cleanup()

    @classmethod
    def request(cls, method, path, body=None, raw=False):
        conn = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=15)
        try:
            if body is not None and not raw:
                body = json.dumps(body)
            headers = {"Content-Type": "application/json"} if body is not None else {}
            conn.request(method, path, body=body, headers=headers)
            res = conn.getresponse()
            return res.status, res.read()
        finally:
            conn.close()

    def sample(self, prompt):
        status, body = self.request("POST", "/api/sample", {"prompt": prompt})
        self.assertEqual(status, 200)
        return [json.loads(line) for line in body.decode().splitlines() if line.strip()]

    # -- static ----------------------------------------------------------

    def test_index_has_runtime_injected_before_any_script(self):
        on_disk = (REPO / "index.html").read_bytes()
        for path in ("/", "/index.html"):
            status, body = self.request("GET", path)
            self.assertEqual(status, 200)
            html = body.decode("utf-8")
            first = html.find("<script")
            self.assertEqual(html.find(RUNTIME_TAG), first)
            self.assertEqual(html.count(RUNTIME_TAG), 1)
            self.assertEqual(body.replace(RUNTIME_TAG.encode(), b"", 1), on_disk)
        self.assertEqual((REPO / "index.html").read_bytes(), on_disk)

    def test_runtime_js_defines_window_claude(self):
        status, body = self.request("GET", "/runtime.js")
        self.assertEqual(status, 200)
        self.assertIn(b"window.claude", body)

    def test_unknown_path_is_404(self):
        for path in ("/nope", "/server/serve.py", "/../index.html", "/build.py"):
            status, _ = self.request("GET", path)
            self.assertEqual(status, 404, path)

    # -- sample ----------------------------------------------------------

    def test_sample_streams_deltas_then_done(self):
        lines = self.sample("Explain the Product Goal")
        deltas = [l["t"] for l in lines if "t" in l]
        self.assertGreater(len(deltas), 1)
        self.assertEqual("".join(deltas), "Hello from fake")
        self.assertEqual(lines[-1], {"done": True, "text": "Hello from fake"})

    def test_sample_result_only_sends_text_as_one_delta(self):
        lines = self.sample("RESULTONLY please")
        self.assertEqual(lines, [{"t": "Only the result"}, {"done": True, "text": "Only the result"}])

    def test_sample_failure_ends_with_error_line(self):
        lines = self.sample("please FAIL")
        self.assertIn("error", lines[-1])
        self.assertFalse(any("done" in l for l in lines))

    def test_sample_empty_prompt_is_400(self):
        for body in ({"prompt": ""}, {}, {"prompt": 42}):
            status, _ = self.request("POST", "/api/sample", body)
            self.assertEqual(status, 400, body)

    def test_sample_oversized_prompt_is_413(self):
        status, _ = self.request("POST", "/api/sample", {"prompt": "x" * 60001})
        self.assertEqual(status, 413)

    def test_sample_over_concurrency_limit_is_429(self):
        started = threading.Event()
        result = {}

        def slow():
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
            try:
                conn.request("POST", "/api/sample", body=json.dumps({"prompt": "SLOW"}),
                             headers={"Content-Type": "application/json"})
                res = conn.getresponse()
                started.set()
                result["status"] = res.status
                result["body"] = res.read()
            finally:
                started.set()
                conn.close()

        t = threading.Thread(target=slow)
        t.start()
        self.assertTrue(started.wait(10))
        status, body = self.request("POST", "/api/sample", {"prompt": "hi"})
        self.assertEqual(status, 429)
        self.assertEqual(json.loads(body), {"code": "rate_limited"})
        t.join(15)
        self.assertEqual(result.get("status"), 200)
        self.assertIn(b'"done": true', result["body"])

    # -- db --------------------------------------------------------------

    def test_db_get_missing_path(self):
        status, body = self.request("GET", "/api/db?path=progress/missing")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"exists": False, "data": None})

    def test_db_put_then_get_roundtrip(self):
        doc = {"done": {"m1": True}, "settings": {"theme": "dark"}, "note": "Grüße"}
        status, body = self.request("PUT", "/api/db?path=progress/state", doc)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True})
        status, body = self.request("GET", "/api/db?path=progress/state")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"exists": True, "data": doc})
        files = sorted(p.name for p in Path(self.data_dir.name).iterdir())
        self.assertEqual(files, ["progress__state.json"])

    def test_db_invalid_paths_are_400(self):
        for p in ("../x", "progress", "a/b/c", "", "Progress/State", "a/..%2Fb"):
            status, _ = self.request("GET", f"/api/db?path={p}")
            self.assertEqual(status, 400, p)
            status, _ = self.request("PUT", f"/api/db?path={p}", {"a": 1})
            self.assertEqual(status, 400, p)

    def test_db_non_object_body_is_400(self):
        for body in ("[1, 2]", "42", "\"s\"", "null", "not json"):
            status, _ = self.request("PUT", "/api/db?path=progress/other", body, raw=True)
            self.assertEqual(status, 400, body)


if __name__ == "__main__":
    unittest.main()
