"""
OpenCode's /event stream only reports a session's activity to a caller
that subscribed with that session's own directory — there's no single
global feed covering every session. So this opens one SSE connection per
session (matching our one-directory-per-session model in sessions.py) and
fans each session's events out to whatever websocket(s) are watching it.
"""

import asyncio
from pathlib import Path

from app.opencode_client import OpenCodeClient


class EventBridge:
    def __init__(self, client: OpenCodeClient) -> None:
        self._client = client
        self._queues: dict[str, list[asyncio.Queue]] = {} # Each queue corresponds to a single tab listening to a single session's event stream
        self._pumps: dict[str, asyncio.Task] = {}

    async def start_session(self, session_id: str, directory: Path) -> None:
        self._pumps[session_id] = asyncio.create_task(self._pump(session_id, directory))
        # Give the SSE connection a moment to open server-side before the
        # caller sends a message — otherwise the first permission.asked
        # could fire before anyone's subscribed to hear it.
        await asyncio.sleep(0.2)

    def subscribe(self, session_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._queues.setdefault(session_id, []).append(queue)
        return queue

    def unsubscribe(self, session_id: str, queue: asyncio.Queue) -> None:
        subscribers = self._queues.get(session_id, [])
        if queue in subscribers:
            subscribers.remove(queue)

    async def _pump(self, session_id: str, directory: Path) -> None:
      
        while True:
            try:
                async for event in self._client.events(directory):
                    for queue in self._queues.get(session_id, []):
                        queue.put_nowait(event)
            
            # If the SSE connection drops, reconnect rather than leaving this
            # session's websocket silently stuck with no more events.
            except Exception:
                await asyncio.sleep(1)
