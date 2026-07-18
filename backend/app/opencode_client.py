"""
Wrapper around a single `opencode serve` process. Owns the subprocess
and exposes the handful of REST/SSE calls the rest of the backend needs —
nothing generic or SDK-shaped, just what this app actually calls.
"""

import asyncio
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
OPENCODE_PORT = int(os.environ.get("OPENCODE_PORT", "4096"))
OPENCODE_URL = f"http://127.0.0.1:{OPENCODE_PORT}"

# The message endpoint blocks until the agent either finishes or hits a
# permission it needs a reply to, which can be an arbitrarily long wait —
# The standard httpx shouldn't interfere here
NO_TIMEOUT = httpx.Timeout(None)


class OpenCodeClient:
    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._http = httpx.AsyncClient(base_url=OPENCODE_URL, timeout=NO_TIMEOUT) # this is a http connection tool to the open code server process we can reference

    async def start(self) -> None:
        # opencode picks up provider credentials (e.g. OPENAI_API_KEY) from its own process env
        load_dotenv(REPO_ROOT / ".env")

        self._process = await asyncio.create_subprocess_exec(
            "opencode", "serve", "--port", str(OPENCODE_PORT),
            env=dict(os.environ),
        )
        await self._wait_until_ready()

    async def _wait_until_ready(self, timeout_seconds: float = 15.0) -> None:
        deadline = asyncio.get_event_loop().time() + timeout_seconds
        while asyncio.get_event_loop().time() < deadline:
            try:
                response = await self._http.get("/global/health", timeout=1.0)
                if response.status_code == 200:
                    return
            except httpx.TransportError:
                pass
            await asyncio.sleep(0.3)
        raise RuntimeError("opencode serve did not become ready in time")

    async def stop(self) -> None:
        await self._http.aclose()
        if self._process is not None:
            try:
                self._process.terminate()
            except ProcessLookupError:
                pass  # already exited, e.g. someone killed it directly
            await self._process.wait()

    async def create_session(
        self, directory: Path, permission: list[dict[str, str]], model: dict[str, str]
    ) -> dict[str, Any]:
        response = await self._http.post(
            "/session",
            params={"directory": str(directory)}, # directory is the working directory the opencode server will operate in this session
            json={"model": model, "permission": permission}, # permissions set which tools are auto-allowed and which should be asked. To implement human in the loop for certain actions like applying edits to a slide
        )
        response.raise_for_status() # Make the failure loud in case of bad requests
        return response.json()

    async def send_message(
        self,
        session_id: str,
        directory: Path,
        text: str,
        model: dict[str, str],
        system: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "parts": [{"type": "text", "text": text}],
        }
        if system is not None:
            body["system"] = system
        response = await self._http.post(
            f"/session/{session_id}/message",
            params={"directory": str(directory)},
            json=body,
        )
        response.raise_for_status()
        return response.json()

    async def get_messages(self, session_id: str, directory: Path) -> list[dict[str, Any]]:
        # Full message history for the session — [{info: {...}, parts: [...]}].
        # Used to replay a session's transcript when a client reconnects to
        # it instead of starting from a blank chat.
        response = await self._http.get(
            f"/session/{session_id}/message",
            params={"directory": str(directory)},
        )
        response.raise_for_status()
        return response.json()

    # This function is where we send a reply (the user's choice) to a certain permission event sent by opencode server. Allow/Deny
    async def reply_permission(
        self, request_id: str, directory: Path, reply: str
    ) -> None:
        response = await self._http.post(
            f"/permission/{request_id}/reply",
            params={"directory": str(directory)},
            json={"reply": reply},
        )
        response.raise_for_status()

    async def events(self, directory: Path) -> AsyncIterator[dict[str, Any]]:
        """
        Yields events scoped to one working directory. OpenCode's /event
        stream only reports a session's activity to callers who subscribed
        with that session's own directory — an unscoped subscribe sees
        just server-level events (connected, heartbeat), nothing per-session.
        """

        # Open the SSE event stream. 
        # async with means "keep this connection open for the rest of this block, and close it properly when we're done or if something goes wrong."
        async with self._http.stream(
            "GET", "/event", params={"directory": str(directory)}
        ) as response:
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line.removeprefix("data: ")
                try:
                    yield json.loads(payload)
                except json.JSONDecodeError:
                    continue
