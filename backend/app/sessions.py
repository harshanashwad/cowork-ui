"""
Core purpose: Maintain a in-memory registry of our opencode sessions
"""

import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from app import artifact
from app.opencode_client import OpenCodeClient

WORKDIRS_ROOT = Path(__file__).resolve().parents[1] / "workdirs"
SAMPLE_DECK = Path(__file__).resolve().parents[1] / "sample_deck"

PROVIDER_ID = "opencode"
MODEL_ID = "hy3-free"  # OpenCode Zen's free tier

# The real deck file is never editable directly — an agent's turn edits a
# scratch copy freely instead, reviewed and merged as a whole once the turn
# finishes (see ws.py). Bash is still asked individually, same as before.
#
# Patterns must be globs, not bare filenames — a plain "slides.md" silently
# fails to match anything (OpenCode falls through to its own implicit
# default-allow rule), confirmed by testing a denied edit directly against
# the running server before trusting this.
PERMISSION_RULESET = [
    {"permission": "edit", "pattern": f"**/{artifact.DECK_FILENAME}", "action": "deny"},
    {"permission": "edit", "pattern": f"**/{artifact.DECK_COPY_FILENAME}", "action": "allow"},
    {"permission": "bash", "pattern": "*", "action": "ask"},
]


@dataclass
class Session:
    id: str # this id is returned by opencode client when we create a session
    directory: Path # this is the working directory the opencode server
    # Both are identifiers pointing to the same thing. But /events needs the directory whereas other endpoints need the id too.
    title: str # placeholder display label for the sidebar — sequential for now, not persisted across restarts


class SessionRegistry:
    def __init__(self, client: OpenCodeClient) -> None:
        self._client = client
        self._sessions: dict[str, Session] = {}  # insertion order == creation order

    async def create(self) -> Session:
        directory = WORKDIRS_ROOT / f"session-{uuid.uuid4().hex[:8]}"
        shutil.copytree(SAMPLE_DECK, directory)  # every session starts from the same demo deck
        artifact.init_repo(directory)

        opencode_session = await self._client.create_session(
            directory=directory,
            permission=PERMISSION_RULESET,
            model={"providerID": PROVIDER_ID, "id": MODEL_ID},
        )
        title = f"Session {len(self._sessions) + 1}"
        session = Session(id=opencode_session["id"], directory=directory, title=title)
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def list_all(self) -> list[Session]:
        # Newest first, to match how a "Recents" list reads.
        return list(reversed(self._sessions.values()))
