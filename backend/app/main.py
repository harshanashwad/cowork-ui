"""
The FastAPI app. Owns the OpenCode subprocess and the event bridge for the
process lifetime, and exposes the one REST route (create a session) plus
the websocket route that does everything else.
"""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app import artifact, ws
from app.event_bridge import EventBridge
from app.opencode_client import OpenCodeClient
from app.sessions import SessionRegistry

# lifespan is the fastapi hook that tells 'run this code once when the server starts'
@asynccontextmanager
async def lifespan(app: FastAPI):
    client = OpenCodeClient()
    await client.start()

    # Only one opencode client is needed. It is passed as argument for session registry and event bridge.
    app.state.client = client
    app.state.sessions = SessionRegistry(client)
    app.state.bridge = EventBridge(client)

    yield

    await client.stop()


app = FastAPI(lifespan=lifespan)
app.include_router(ws.router)


class SessionOut(BaseModel):
    id: str
    directory: str
    title: str


@app.post("/api/sessions", response_model=SessionOut)
async def create_session() -> SessionOut:
    session = await app.state.sessions.create()
    await app.state.bridge.start_session(session.id, session.directory)
    return SessionOut(id=session.id, directory=str(session.directory), title=session.title)


@app.get("/api/sessions", response_model=list[SessionOut])
async def list_sessions() -> list[SessionOut]:
    # Sidebar's "Recents" list. Only reflects sessions created since the
    # backend last started — SessionRegistry is in-memory, nothing persisted
    # to disk beyond the sessions' own working directories.
    return [
        SessionOut(id=s.id, directory=str(s.directory), title=s.title)
        for s in app.state.sessions.list_all()
    ]


@app.get("/api/sessions/{session_id}/messages")
async def get_session_messages(session_id: str) -> list[dict]:
    # Raw OpenCode message history — the frontend replays it through the
    # same event-parsing logic it uses for live events, so a reopened
    # session shows its prior transcript instead of starting blank.
    session = app.state.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return await app.state.client.get_messages(session_id, session.directory)


@app.get("/api/sessions/{session_id}/history")
async def get_history(session_id: str) -> list[dict[str, str]]:
    # Whole-deck commit history for the version history sidebar — no
    # per-slide detail, just the flat commit list, most recent first.
    session = app.state.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return await asyncio.to_thread(artifact.log, session.directory)


class RevertIn(BaseModel):
    commit: str


@app.post("/api/sessions/{session_id}/revert")
async def revert_session(session_id: str, body: RevertIn) -> dict[str, list[str]]:
    session = app.state.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    await asyncio.to_thread(artifact.revert_to, session.directory, body.commit)
    filenames = await asyncio.to_thread(_render_current, session.directory)
    return {"filenames": filenames}


@app.get("/api/sessions/{session_id}/thumbnails")
async def get_thumbnails(session_id: str) -> dict[str, list[str]]:
    # Always re-renders the current on-disk deck rather than tracking
    # render state separately — one source of truth (the file itself),
    # nothing that can drift out of sync after an approve/reject/revert.
    session = app.state.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    filenames = await asyncio.to_thread(_render_current, session.directory)
    return {"filenames": filenames}


def _render_current(directory: Path) -> list[str]:
    return [p.name for p in artifact.render_deck(directory)]


@app.post("/api/sessions/{session_id}/upload")
async def upload_file(session_id: str, file: UploadFile) -> dict[str, str]:
    session = app.state.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    if not file.filename or "/" in file.filename:
        raise HTTPException(status_code=400, detail="invalid filename")

    dest = session.directory / file.filename
    dest.write_bytes(await file.read())
    return {"filename": file.filename}


# artifact.render_deck() produces the images this route serves, e.g.
# "before-review_xyz.001.png" — the ApprovalCard's <img> tags point straight here.
@app.get("/api/sessions/{session_id}/render/{filename}")
async def get_render(session_id: str, filename: str) -> FileResponse:
    if "/" in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="invalid filename")

    session = app.state.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    path = session.directory / artifact.RENDER_DIRNAME / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="render not found")
    # Filenames are unique per turn (see ws.py), so this shouldn't be
    # needed — but a stale cached slide image is exactly the kind of bug
    # that's invisible until a demo, so belt and suspenders.
    return FileResponse(path, headers={"Cache-Control": "no-store"})
