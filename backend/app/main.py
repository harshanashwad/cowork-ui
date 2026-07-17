"""
The FastAPI app. Owns the OpenCode subprocess and the event bridge for the
process lifetime, and exposes the one REST route (create a session) plus
the websocket route that does everything else.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from app import ws
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


@app.post("/api/sessions", response_model=SessionOut)
async def create_session() -> SessionOut:
    session = await app.state.sessions.create()
    await app.state.bridge.start_session(session.id, session.directory)
    return SessionOut(id=session.id, directory=str(session.directory))
