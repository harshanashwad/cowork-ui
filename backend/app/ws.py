"""
The websocket a client drives one session through: send it a message,
watch OpenCode's own events arrive live, and approve/reject the
end-of-turn review card. One connection per session.

The deck is a real .pptx file. OpenCode's edit tool can't touch binary
files, so the agent edits it via bash + python-pptx instead — see
SYSTEM_PROMPT. bash runs unrestricted (sessions.py's PERMISSION_RULESET);
the real deck file is protected by making it read-only at the OS level
for the duration of a turn (artifact.protect/unprotect) instead, since
OpenCode's bash permission patterns don't reliably scope to one file.

Each turn's edits go to artifact.DECK_COPY_FILENAME; once the turn
finishes, this module renders both files and sends a "turn.review" card.
Approving merges the copy over the real deck and commits once for the
whole turn; rejecting discards the copy. No per-edit gating, no mid-turn
interruptions.
"""

import asyncio
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import artifact
from app.event_bridge import EventBridge
from app.opencode_client import OpenCodeClient
from app.sessions import MODEL_ID, PROVIDER_ID, Session, SessionRegistry

router = APIRouter()

SYSTEM_PROMPT = (
    f"You are editing a slide deck stored as {artifact.DECK_FILENAME}, a real "
    f"PowerPoint file. {artifact.DECK_FILENAME} itself is read-only for this turn — "
    f"any attempt to write to it will fail with a permission error. Make all your "
    f"changes to {artifact.DECK_COPY_FILENAME} instead, using the bash tool to run "
    f"python-pptx code against it, e.g.:\n"
    f"  from pptx import Presentation\n"
    f"  prs = Presentation('{artifact.DECK_COPY_FILENAME}')\n"
    f"  ...\n"
    f"  prs.save('{artifact.DECK_COPY_FILENAME}')\n"
    f"{artifact.DECK_COPY_FILENAME} starts this turn as an exact copy of "
    f"{artifact.DECK_FILENAME}. A human will review your changes, rendered as "
    f"images, and merge them once you're done. If a request is ambiguous, do not "
    f"ask a clarifying question — make a reasonable choice yourself and state your "
    f"assumption in your reply.\n\n"
    f"Two hard rules about filenames, with no exceptions: never write to, copy "
    f"over, or otherwise modify {artifact.DECK_FILENAME} yourself, even at the very "
    f"end of your work — it stays read-only for the whole turn, and merging your "
    f"changes into it is handled automatically after human review, not something "
    f"you do. And never rename, move, or copy {artifact.DECK_COPY_FILENAME} to any "
    f"other filename (e.g. 'updated_deck.pptx', 'final.pptx') — your finished edit "
    f"must be sitting at exactly {artifact.DECK_COPY_FILENAME} when you're done, "
    f"since that is the exact path the review step reads from; saving it anywhere "
    f"else means your work is invisible to the review and effectively lost, "
    f"regardless of what you tell the user.\n\n"
    f"Before adding a chart (or any new shape) to a slide, run "
    f"`python3 {artifact.HELPER_FILENAME} {artifact.DECK_COPY_FILENAME} <slide_index>` "
    f"via bash first to see the left/top/width/height of every shape already on that "
    f"slide, in inches. Use that to find an unoccupied region large enough for a "
    f"reasonably-sized chart (at least a few inches in each dimension) and place the "
    f"new shape there — do not use fixed or guessed coordinates, and do not assume a "
    f"slide is empty without checking. When passing position/size to python-pptx (e.g. "
    f"shapes.add_chart's x, y, cx, cy), always wrap the inch values with "
    f"`from pptx.util import Inches; Inches(1.0)` — never pass raw numbers, since "
    f"python-pptx expects EMU integers there and a raw float silently corrupts the file.\n\n"
    f"When you finish making changes this turn, end your reply with one line in exactly "
    f"this format, on its own line after your normal explanation — it becomes the git "
    f"commit message for your changes, so keep it short and specific to what you actually "
    f"did:\n"
    f"Summary: <short description>\n"
    f'e.g. "Summary: Added a bar chart to slide 3" or "Summary: Reworded the title on '
    f'slide 1". If you made no changes this turn, omit this line entirely.'
)

COMMIT_SUMMARY_PATTERN = re.compile(r"^Summary:\s*(.+)$", re.MULTILINE | re.IGNORECASE)
FALLBACK_COMMIT_MESSAGE = "Approved turn"
COMMIT_SUBJECT_MAX_LEN = 72


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

    # Turn state (busy/pending_review/render_error) lives on the Session
    # itself, not in a dict scoped to this connection — see the comment on
    # Session in sessions.py. Replay whatever's still outstanding so a
    # reconnect (browser back/forward, tab reload) sees the same card a
    # continuously-connected client would, instead of a blank chat that
    # looks idle while a turn is still actually in flight or awaiting review.
    if session.render_error is not None:
        await websocket.send_json(_render_failed_event(session.render_error))
    elif session.pending_review is not None and session.pending_preview is not None:
        await websocket.send_json(_review_event(session.pending_review, session.pending_preview))

    async def forward_events() -> None:
        while True:
            event = await queue.get()
            await websocket.send_json(event)

    async def send_and_report(text: str, attachments: list[str]) -> None:
        deck_path = session.directory / artifact.DECK_FILENAME
        copy_path = session.directory / artifact.DECK_COPY_FILENAME
        try:
            if not deck_path.is_file():
                # A brand new session has no deck until a .pptx is uploaded —
                # a real, reachable state now, not just a theoretical one.
                await websocket.send_json({
                    "type": "turn.failed",
                    "error": "Upload a .pptx first — this session doesn't have a deck yet.",
                })
                session.busy = False
                return

            await asyncio.to_thread(shutil.copy, deck_path, copy_path)
            await asyncio.to_thread(artifact.protect, deck_path)

            system = SYSTEM_PROMPT
            if attachments:
                # Told via system, not appended to the visible message text,
                # so the user's own chat bubble shows exactly what they typed.
                system += (
                    "\n\nThe user attached these files to this message, already "
                    "saved in the working directory: " + ", ".join(attachments)
                )

            # This blocks until the agent finishes the whole turn, so it
            # always runs as its own task rather than in the receive loop.
            result = await client.send_message(
                session_id=session.id,
                directory=session.directory,
                text=text,
                model={"providerID": PROVIDER_ID, "modelID": MODEL_ID},
                system=system,
            )

            if await asyncio.to_thread(_files_equal, deck_path, copy_path):
                # Nothing changed this turn — no draft to review.
                await asyncio.to_thread(artifact.unprotect, deck_path)
                await asyncio.to_thread(copy_path.unlink, missing_ok=True)
                await websocket.send_json({"type": "app.message.result", "result": result})
                session.busy = False
                return

            # The edit itself already succeeded and is sitting safely in
            # copy_path by this point — only the render-and-review step is
            # left, and it fails for reasons unrelated to the edit (a
            # transient soffice hiccup, disk pressure). If it does, that
            # success shouldn't be thrown away: stay busy (deck.pptx stays
            # protected, so nothing can overwrite copy_path out from under
            # this) and let the client retry the render alone via
            # "retry_render" instead of re-running the whole turn.
            review_id = f"review_{result['info']['id']}"
            # Set once, from the agent's own reply, regardless of whether
            # rendering below succeeds on the first try or needs a
            # retry_render — a render retry shouldn't lose the summary any
            # more than it should lose the edit itself.
            session.pending_commit_message = _extract_commit_message(result)
            try:
                before, after = await asyncio.to_thread(_render_turn, session.directory, review_id)
            except Exception as exc:
                session.render_error = {"review_id": review_id, "message": str(exc)}
                await websocket.send_json(_render_failed_event(session.render_error))
                await websocket.send_json({"type": "app.message.result", "result": result})
                return

            session.pending_review = review_id
            session.pending_preview = {"before": before, "after": after}
            # Sent before app.message.result so the frontend's pending-approval
            # entry already exists by the time it clears its own "sending" state.
            await websocket.send_json(_review_event(review_id, session.pending_preview))
            await websocket.send_json({"type": "app.message.result", "result": result})
        except Exception as exc:
            # Without this, a crash here would leave deck.pptx permanently
            # read-only (from the protect() call above) with no way to
            # recover, on top of leaving "busy" stuck true forever. This
            # branch only covers failures before a successful edit exists
            # (e.g. the agent call itself blowing up) — a render failure
            # after a successful edit is handled above and deliberately
            # doesn't reach here.
            await asyncio.to_thread(artifact.unprotect, deck_path)
            session.busy = False
            session.pending_review = None
            session.pending_preview = None
            session.pending_commit_message = None
            session.render_error = None
            await websocket.send_json({"type": "turn.failed", "error": str(exc)})

    forward_task = asyncio.create_task(forward_events())
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("type")
            if action == "message":
                if session.busy:
                    continue  # a turn is already in flight or awaiting review
                # Set synchronously, here, before scheduling the task — the
                # task's own body won't actually run until the next await
                # point, which is too late to close the race against a
                # second "message" arriving right behind this one. Being on
                # the Session (not this connection's local state) is what
                # makes this gate hold across a reconnect too.
                session.busy = True
                asyncio.create_task(send_and_report(data["text"], data.get("attachments") or []))
            elif action == "retry_render":
                if session.render_error is None:
                    continue  # nothing outstanding to retry
                review_id = session.render_error["review_id"]
                try:
                    before, after = await asyncio.to_thread(_render_turn, session.directory, review_id)
                except Exception as exc:
                    session.render_error = {"review_id": review_id, "message": str(exc)}
                    await websocket.send_json(_render_failed_event(session.render_error))
                    continue
                session.render_error = None
                session.pending_review = review_id
                session.pending_preview = {"before": before, "after": after}
                await websocket.send_json(_review_event(review_id, session.pending_preview))
            elif action == "permission_reply":
                request_id = data["request_id"]
                if request_id == session.pending_review:
                    commit_message = session.pending_commit_message or FALLBACK_COMMIT_MESSAGE
                    await _resolve_turn(
                        session, review_id=request_id, reply=data["reply"],
                        websocket=websocket, commit_message=commit_message,
                    )
                    session.pending_review = None
                    session.pending_preview = None
                    session.pending_commit_message = None
                    session.busy = False
                else:
                    # A real OpenCode permission — none currently ask by
                    # default (bash is "allow"), but this stays as the
                    # general path in case that ever changes.
                    await client.reply_permission(
                        request_id=request_id,
                        directory=session.directory,
                        reply=data["reply"],
                    )
            elif action == "question_reply":
                # A question is the agent asking the user something mid-turn
                # — a separate mechanism from permissions (its own event
                # type, its own reply endpoint). "busy" is already true and
                # stays true until the turn itself finishes; no extra state
                # to track here beyond forwarding the answer.
                await client.reply_question(
                    request_id=data["request_id"],
                    directory=session.directory,
                    answers=data["answers"],
                )
            elif action == "question_reject":
                await client.reject_question(
                    request_id=data["request_id"],
                    directory=session.directory,
                )
    except WebSocketDisconnect:
        pass
    finally:
        forward_task.cancel()
        bridge.unsubscribe(session_id, queue)


def _files_equal(a: Path, b: Path) -> bool:
    return a.read_bytes() == b.read_bytes()


def _extract_commit_message(result: dict) -> str:
    """
    Pulls the "Summary: ..." line the system prompt asks the agent to end
    its reply with, for use as the commit message on an approved turn —
    a real, specific description of the edit instead of a generic
    "Approved turn" every time. Falls back to that generic message if the
    agent's reply doesn't contain one (shouldn't happen once the prompt
    change lands, but this must never fail the commit over a formatting
    slip).
    """
    text = "\n".join(
        part.get("text", "") for part in result.get("parts", []) if part.get("type") == "text"
    )
    matches = COMMIT_SUMMARY_PATTERN.findall(text)
    if not matches:
        return FALLBACK_COMMIT_MESSAGE
    summary = matches[-1].strip()  # last match: the agent's actual final line, not an example
    if not summary:
        return FALLBACK_COMMIT_MESSAGE
    if len(summary) > COMMIT_SUBJECT_MAX_LEN:
        summary = summary[: COMMIT_SUBJECT_MAX_LEN - 1].rstrip() + "…"
    return summary


def _review_event(review_id: str, preview: dict[str, list[str]]) -> dict:
    return {
        "type": "turn.review",
        "properties": {
            "id": review_id,
            "summary": "Review the agent's changes to the deck",
            "preview": preview,
        },
    }


def _render_failed_event(render_error: dict[str, str]) -> dict:
    # The agent's edit already succeeded and is sitting in deck_copy.pptx —
    # only rendering it for review failed. "retry_render" (see the receive
    # loop) re-runs just that step, no need to redo the edit itself.
    return {
        "type": "turn.render_failed",
        "properties": {"id": render_error["review_id"], "error": render_error["message"]},
    }


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


async def _resolve_turn(
    session: Session, review_id: str, reply: str, websocket: WebSocket, commit_message: str
) -> None:
    deck_path = session.directory / artifact.DECK_FILENAME
    copy_path = session.directory / artifact.DECK_COPY_FILENAME

    await asyncio.to_thread(artifact.unprotect, deck_path)
    if reply == "reject":
        await asyncio.to_thread(copy_path.unlink, missing_ok=True)
    else:
        await asyncio.to_thread(shutil.move, copy_path, deck_path)
        await asyncio.to_thread(artifact.commit, session.directory, commit_message)

    # Mirrors OpenCode's own permission.replied shape so the frontend's
    # existing resolved-state handling works unchanged for this synthetic
    # review too — it only matches on requestID, not on where the event
    # actually came from.
    await websocket.send_json({
        "type": "permission.replied",
        "properties": {"sessionID": session.id, "requestID": review_id, "reply": reply},
    })
