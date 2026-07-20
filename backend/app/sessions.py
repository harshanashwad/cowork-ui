"""
Core purpose: Maintain a in-memory registry of our opencode sessions
"""

import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app import artifact
from app.opencode_client import OpenCodeClient

WORKDIRS_ROOT = Path(__file__).resolve().parents[1] / "workdirs"
# pptx_helpers.py lives alongside this module in the backend source tree —
# copied into each new session directory so the agent can run it via bash.
HELPER_SOURCE = Path(__file__).resolve().parent / artifact.HELPER_FILENAME

PROVIDER_ID = "opencode"
MODEL_ID = "hy3-free"  # OpenCode Zen's free tier

# deck.pptx is binary, so OpenCode's edit tool can't touch it anyway — the
# agent edits deck_copy.pptx via bash + python-pptx instead (see ws.py).
# bash runs unrestricted here: OpenCode's bash permission patterns don't
# reliably scope to a specific file (confirmed directly — a deny rule
# naming the exact protected filename still let a matching command
# through), so gating bash per-call would add mid-turn interruptions
# without actually protecting anything. The real protection is
# artifact.protect(), which makes deck.pptx read-only at the OS level for
# the duration of a turn — that can't be talked around the way the
# permission pattern could.
PERMISSION_RULESET = [
    {"permission": "bash", "pattern": "*", "action": "allow"},
]


@dataclass
class Session:
    id: str # this id is returned by opencode client when we create a session
    directory: Path # this is the working directory the opencode server
    # Both are identifiers pointing to the same thing. But /events needs the directory whereas other endpoints need the id too.
    title: str # placeholder display label for the sidebar — sequential for now, not persisted across restarts

    # Turn state lives here, on the Session itself, rather than in a dict
    # scoped to one websocket connection (see ws.py). It has to survive a
    # reconnect: a browser tab closing/reopening mid-turn opens a *second*
    # websocket onto the same session, and if that second connection got its
    # own fresh "busy: False" it could fire a second concurrent turn against
    # the same deck_copy.pptx while the first (orphaned) turn is still
    # running — confirmed as the actual cause of a render step crashing on
    # a missing intermediate file (two renders racing on the same directory).
    busy: bool = False
    pending_review: str | None = None
    pending_preview: dict[str, list[str]] | None = None
    render_error: dict[str, str] | None = None
    # The commit message for the currently pending review, parsed from the
    # agent's own final reply (see ws.py's SYSTEM_PROMPT/_extract_commit_message).
    # Set once the agent's message result comes back, independent of whether
    # rendering succeeds on the first try or needs a retry_render — so a
    # retry doesn't lose the summary the same way it doesn't lose the edit.
    pending_commit_message: str | None = None

    # Commits "deleted" from the version history sidebar. This is a display
    # filter only — git history itself is never rewritten (dropping a commit
    # from the middle of the chain would change every later commit's hash,
    # real risk for no real benefit here). See main.py's hide endpoint.
    hidden_commits: set[str] = field(default_factory=set)


class SessionRegistry:
    def __init__(self, client: OpenCodeClient) -> None:
        self._client = client
        self._sessions: dict[str, Session] = {}  # insertion order == creation order

    async def create(self) -> Session:
        # Starts completely empty — no deck at all. The user uploads a
        # .pptx from within the session (the same attach button used for
        # any other file; see main.py's upload endpoint) to load one.
        directory = WORKDIRS_ROOT / f"session-{uuid.uuid4().hex[:8]}"
        directory.mkdir(parents=True)
        artifact.init_repo(directory)
        # So the agent can call list_shape_bounds() via bash before placing
        # a new shape, instead of guessing overlap from the pptx internals.
        shutil.copy(HELPER_SOURCE, directory / artifact.HELPER_FILENAME)

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

    def delete(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return
        # deck.pptx may still be chmod 444 from artifact.protect() if a
        # turn got interrupted mid-flight — that only blocks writing to the
        # file itself, not removing it from a directory this process owns,
        # but chmod it back first anyway rather than relying on that.
        deck_path = session.directory / artifact.DECK_FILENAME
        if deck_path.exists():
            artifact.unprotect(deck_path)
        shutil.rmtree(session.directory, ignore_errors=True)
