"""
Throwaway script for Phase 0: proves the OpenCode integration works at all,
before any FastAPI routes or UI exist.

What it does, in order:
  1. Creates a scratch working directory with one small text file.
  2. Creates a new OpenCode session rooted at that directory.
  3. Opens the raw SSE event stream (GET /event) and prints every event as
     it arrives, in a background thread.
  4. Sends the session one message asking the agent to edit the file.
  5. Prints the final assistant response, then exits.

Run `opencode serve --port 4096` in another terminal first, then:
    backend/.venv/bin/python backend/scratch/probe.py
"""

import json
import threading
import time
from pathlib import Path

import httpx

OPENCODE_URL = "http://127.0.0.1:4096"
PROVIDER_ID = "opencode"  # OpenCode Zen's free tier — no API key needed
MODEL_ID = "hy3-free"

WORKDIR = Path(__file__).parent / "probe_workdir"
SAMPLE_FILE = WORKDIR / "hello.txt"

MESSAGE = (
    "Read hello.txt in this directory, then append a new line at the end "
    "that says 'Probed by Claude Code phase 0.'"
)


def print_event(event: dict) -> None:
    # Raw dump so every field is visible while watching this by eye.
    print(f"\n--- event: {event.get('type')} ---")
    print(json.dumps(event, indent=2)[:2000])


def stream_events(stop: threading.Event) -> None:
    with httpx.Client(timeout=None) as client:
        with client.stream("GET", f"{OPENCODE_URL}/event") as response:
            for line in response.iter_lines():
                if stop.is_set():
                    return
                if not line.startswith("data: "):
                    continue
                payload = line.removeprefix("data: ")
                try:
                    print_event(json.loads(payload))
                except json.JSONDecodeError:
                    print("(unparsed event line)", payload)


def main() -> None:
    WORKDIR.mkdir(exist_ok=True)
    SAMPLE_FILE.write_text("Hello, world!\n")

    stop = threading.Event()
    listener = threading.Thread(target=stream_events, args=(stop,), daemon=True)
    listener.start()
    time.sleep(0.5)  # let the SSE connection open before triggering anything

    with httpx.Client(timeout=120) as client:
        print(f"Creating session in {WORKDIR} ...")
        session = client.post(
            f"{OPENCODE_URL}/session",
            params={"directory": str(WORKDIR)},
            json={"model": {"providerID": PROVIDER_ID, "id": MODEL_ID}},
        ).raise_for_status().json()
        session_id = session["id"]
        print(f"Session created: {session_id}")

        print(f"Sending message: {MESSAGE!r}")
        result = client.post(
            f"{OPENCODE_URL}/session/{session_id}/message",
            params={"directory": str(WORKDIR)},
            json={
                "model": {"providerID": PROVIDER_ID, "modelID": MODEL_ID},
                "parts": [{"type": "text", "text": MESSAGE}],
            },
        ).raise_for_status().json()

    print("\n=== final assistant message ===")
    print(json.dumps(result, indent=2)[:3000])

    print("\n=== hello.txt after the run ===")
    print(SAMPLE_FILE.read_text())

    stop.set()


if __name__ == "__main__":
    main()
