"""
The websocket a client drives one session through: send it a message,
watch OpenCode's own events arrive live, reply to bash permission asks,
and approve/reject the end-of-turn review card. One connection per session.

Edits never land on slides.md directly anymore — see sessions.py's
PERMISSION_RULESET (deny on the real deck, allow on the scratch copy).
Each turn's edits go to artifact.DECK_COPY_FILENAME; once the turn
finishes, this module renders both files and sends a "turn.review" card.
Approving merges the copy over the real deck and commits once for the
whole turn; rejecting discards the copy. No per-edit gating, no mid-turn
interruptions — bash commands are the only thing still asked individually.
"""

import asyncio
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import artifact
from app.event_bridge import EventBridge
from app.opencode_client import OpenCodeClient
from app.sessions import MODEL_ID, PROVIDER_ID, Session, SessionRegistry

router = APIRouter()

# The deny/allow split in sessions.py's PERMISSION_RULESET is the actual
# backstop that keeps the agent off slides.md — this just means it doesn't
# waste a turn getting denied and figuring that out the hard way.
SYSTEM_PROMPT = (
    f"You are editing a slide deck. {artifact.DECK_FILENAME} is read-only — "
    f"editing it will be denied. Make all your changes to "
    f"{artifact.DECK_COPY_FILENAME} instead; it starts this turn as an exact "
    f"copy of {artifact.DECK_FILENAME}. A human will review your changes to "
    f"{artifact.DECK_COPY_FILENAME} and merge them once you're done."
)


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

    # Shared between send_and_report (which sets these as a turn starts and
    # finishes) and the receive loop (which reads them to gate new messages
    # and to route permission replies). "busy" spans the whole turn, from
    # the moment a message is sent until its review (if any) is resolved —
    # a second message during that window would race the scratch copy the
    # first turn is still using or being reviewed against.
    state: dict[str, Any] = {"busy": False, "pending_review": None}

    async def forward_events() -> None:
        while True:
            event = await queue.get()
            await websocket.send_json(event)

    async def send_and_report(text: str, attachments: list[str]) -> None:
        try:
            deck_path = session.directory / artifact.DECK_FILENAME
            copy_path = session.directory / artifact.DECK_COPY_FILENAME
            await asyncio.to_thread(shutil.copy, deck_path, copy_path)

            system = SYSTEM_PROMPT
            if attachments:
                # Told via system, not appended to the visible message text,
                # so the user's own chat bubble shows exactly what they typed.
                system += (
                    "\n\nThe user attached these files to this message, already "
                    "saved in the working directory: " + ", ".join(attachments)
                )

            # This blocks until the agent finishes or stalls on a bash
            # permission ask, so it always runs as its own task rather than
            # in the receive loop.
            result = await client.send_message(
                session_id=session.id,
                directory=session.directory,
                text=text,
                model={"providerID": PROVIDER_ID, "modelID": MODEL_ID},
                system=system,
            )

            if await asyncio.to_thread(_files_equal, deck_path, copy_path):
                # Nothing changed this turn — no draft to review.
                await asyncio.to_thread(copy_path.unlink, missing_ok=True)
                await websocket.send_json({"type": "app.message.result", "result": result})
                state["busy"] = False
                return

            review_id = f"review_{result['info']['id']}"
            before, after = await asyncio.to_thread(_render_turn, session.directory, review_id)
            state["pending_review"] = review_id
            # Sent before app.message.result so the frontend's pending-approval
            # entry already exists by the time it clears its own "sending" state.
            await websocket.send_json({
                "type": "turn.review",
                "properties": {
                    "id": review_id,
                    "summary": "Review the agent's changes to the deck",
                    "preview": {"before": before, "after": after},
                },
            })
            await websocket.send_json({"type": "app.message.result", "result": result})
        except Exception as exc:
            # Without this, a crash here (bad markdown, OpenCode hiccup) would
            # leave "busy" stuck true forever with no way to send again.
            state["busy"] = False
            state["pending_review"] = None
            await websocket.send_json({"type": "turn.failed", "error": str(exc)})

    forward_task = asyncio.create_task(forward_events())
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("type")
            if action == "message":
                if state["busy"]:
                    continue  # a turn is already in flight or awaiting review
                # Set synchronously, here, before scheduling the task — the
                # task's own body won't actually run until the next await
                # point, which is too late to close the race against a
                # second "message" arriving right behind this one.
                state["busy"] = True
                asyncio.create_task(send_and_report(data["text"], data.get("attachments") or []))
            elif action == "permission_reply":
                request_id = data["request_id"]
                if request_id == state["pending_review"]:
                    await _resolve_turn(session, review_id=request_id, reply=data["reply"], websocket=websocket)
                    state["pending_review"] = None
                    state["busy"] = False
                else:
                    # A real OpenCode permission (currently: bash only).
                    await client.reply_permission(
                        request_id=request_id,
                        directory=session.directory,
                        reply=data["reply"],
                    )
    except WebSocketDisconnect:
        pass
    finally:
        forward_task.cancel()
        bridge.unsubscribe(session_id, queue)


def _files_equal(a: Path, b: Path) -> bool:
    return a.read_text() == b.read_text()


def _render_turn(directory: Path, review_id: str) -> tuple[list[str], list[str]]:
    before = [
        p.name for p in artifact.render_deck(directory, output_prefix=f"before-{review_id}")
    ]
    after = [
        p.name for p in artifact.render_deck(
            directory, deck_filename=artifact.DECK_COPY_FILENAME, output_prefix=f"after-{review_id}"
        )
    ]
    return before, after


async def _resolve_turn(session: Session, review_id: str, reply: str, websocket: WebSocket) -> None:
    copy_path = session.directory / artifact.DECK_COPY_FILENAME
    if reply == "reject":
        await asyncio.to_thread(copy_path.unlink, missing_ok=True)
    else:
        deck_path = session.directory / artifact.DECK_FILENAME
        await asyncio.to_thread(shutil.move, copy_path, deck_path)
        await asyncio.to_thread(artifact.commit, session.directory, "Approved turn")

    # Mirrors OpenCode's own permission.replied shape so the frontend's
    # existing resolved-state handling works unchanged for this synthetic
    # review too — it only matches on requestID, not on where the event
    # actually came from.
    await websocket.send_json({
        "type": "permission.replied",
        "properties": {"sessionID": session.id, "requestID": review_id, "reply": reply},
    })
