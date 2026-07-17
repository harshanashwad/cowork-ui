"""
Core purpose: Maintain a in-memory registry of our opencode sessions
"""

import uuid
from dataclasses import dataclass
from pathlib import Path

from app.opencode_client import OpenCodeClient

WORKDIRS_ROOT = Path(__file__).resolve().parents[1] / "workdirs"

PROVIDER_ID = "opencode"
MODEL_ID = "hy3-free"  # OpenCode Zen's free tier

# Ask before every edit and every shell command. 
PERMISSION_RULESET = [
    {"permission": "edit", "pattern": "*", "action": "ask"},
    {"permission": "bash", "pattern": "*", "action": "ask"},
]


@dataclass
class Session:
    id: str # this id is returned by opencode client when we create a session
    directory: Path # this is the working directory the opencode server
    # Both are identifiers pointing to the same thing. But /events needs the directory whereas other endpoints need the id too.


class SessionRegistry:
    def __init__(self, client: OpenCodeClient) -> None:
        self._client = client
        self._sessions: dict[str, Session] = {}

    async def create(self) -> Session:
        directory = WORKDIRS_ROOT / f"session-{uuid.uuid4().hex[:8]}"
        directory.mkdir(parents=True, exist_ok=True)

        opencode_session = await self._client.create_session(
            directory=directory,
            permission=PERMISSION_RULESET,
            model={"providerID": PROVIDER_ID, "id": MODEL_ID},
        )
        session = Session(id=opencode_session["id"], directory=directory)
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)
