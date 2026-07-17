"""
The websocket a client drives one session through: send it a message,
watch OpenCode's own events arrive live, and reply to whatever permission
it asks for. One connection per session.
"""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.event_bridge import EventBridge
from app.opencode_client import OpenCodeClient
from app.sessions import MODEL_ID, PROVIDER_ID, SessionRegistry

router = APIRouter()


@router.websocket("/ws/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    sessions: SessionRegistry = websocket.app.state.sessions
    client: OpenCodeClient = websocket.app.state.client
    bridge: EventBridge = websocket.app.state.bridge

    session = sessions.get(session_id)
    if session is None:
        await websocket.close(code=4404)
        return

    await websocket.accept() # If the session exists in registry, this line makes websocket connect the browser and the fast api backend
    queue = bridge.subscribe(session_id)

    async def forward_events() -> None:
        while True:
            event = await queue.get()
            await websocket.send_json(event)

    async def send_and_report(text: str) -> None:
        # This blocks until the agent finishes or stalls on a permission ask,
        # so it always runs as its own task rather than in the receive loop.
        result = await client.send_message(
            session_id=session.id,
            directory=session.directory,
            text=text,
            model={"providerID": PROVIDER_ID, "modelID": MODEL_ID},
        )
        await websocket.send_json({"type": "app.message.result", "result": result}) # result is a formal completion signal for the message sent. The response has been streamed through forward_events()

    # forward events and send and report run as asyncio tasks so that both messages and permissions can be listened without one obstructing the other
    forward_task = asyncio.create_task(forward_events())
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("type")
            if action == "message":
                asyncio.create_task(send_and_report(data["text"]))
            elif action == "permission_reply":
                await client.reply_permission(
                    request_id=data["request_id"],
                    directory=session.directory,
                    reply=data["reply"],
                )
    except WebSocketDisconnect:
        pass
    finally:
        forward_task.cancel()
        bridge.unsubscribe(session_id, queue)
