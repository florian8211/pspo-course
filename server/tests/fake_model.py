"""Stand-in for the claude CLI: reads a prompt on stdin, prints stream-json lines."""

import json
import sys
import time


def out(obj):
    print(json.dumps(obj), flush=True)


def delta(text):
    out({"type": "stream_event",
         "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}}})


def result(text, is_error=False):
    out({"type": "result", "subtype": "error" if is_error else "success",
         "is_error": is_error, "result": text})


prompt = sys.stdin.read()
out({"type": "system", "subtype": "init"})

if "FAIL" in prompt:
    result("boom", is_error=True)
    sys.exit(1)
if "SLOW" in prompt:
    time.sleep(3)
if "RESULTONLY" in prompt:
    result("Only the result")
    sys.exit(0)

for part in ("Hello ", "from ", "fake"):
    delta(part)
result("Hello from fake")
