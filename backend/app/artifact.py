"""
Everything that treats a session's working directory as a slide deck:
git-backed version history, rendering the deck to images, and the
read-only protection that keeps the agent off the real file during a
turn. Nothing here talks to OpenCode — it only operates on files already
sitting in a directory.

The deck is a real .pptx file. Rendering is a two-step pipeline —
LibreOffice's own PNG export only produces one image regardless of slide
count (confirmed directly), so this converts to PDF first, then
rasterizes each page with PyMuPDF.
"""

import subprocess
import tempfile
from pathlib import Path

import fitz  # PyMuPDF

DECK_FILENAME = "deck.pptx"
DECK_COPY_FILENAME = "deck_copy.pptx"  # scratch draft an agent's turn edits freely; see ws.py
RENDER_DIRNAME = ".render"  # generated thumbnails — not part of the deck's own history
HELPER_FILENAME = "pptx_helpers.py"  # copied into every session dir at creation; see sessions.py


# --- version history -------------------------------------------------------

def init_repo(directory: Path) -> None:
    # Turns a session's directory into its own git repo, if it isn't one yet.
    if (directory / ".git").exists():
        return
    # Generated thumbnails and the in-progress scratch draft aren't real deck
    # content — the draft only ever gets into the real history by being
    # merged over deck.pptx (see ws.py's approval flow), never committed itself.
    # The helper script is tooling, not deck content, same reasoning.
    (directory / ".gitignore").write_text(
        f"{RENDER_DIRNAME}/\n{DECK_COPY_FILENAME}\n{HELPER_FILENAME}\n"
    )
    _git(["init"], directory)
    _git(["config", "user.email", "cowork-ui@local"], directory)
    _git(["config", "user.name", "cowork-ui"], directory)
    commit(directory, "Initial commit") # baseline — the session may not have a deck yet at all


def commit(directory: Path, message: str) -> None:
    _git(["add", "-A"], directory)
    result = subprocess.run(
        ["git", "commit", "-m", message],
        cwd=directory, capture_output=True, text=True,
    )
    # An approved edit that happens to leave the tree unchanged shouldn't
    # be treated as a failure.
    if result.returncode != 0 and "nothing to commit" not in result.stdout:
        raise RuntimeError(f"git commit failed:\n{result.stdout}{result.stderr}")


def log(directory: Path) -> list[dict[str, str]]:
    """This deck's whole commit history, most recent first — no per-slide detail."""
    result = subprocess.run(
        ["git", "log", "--pretty=format:%H%x1f%s"],
        cwd=directory, capture_output=True, text=True, check=True,
    )
    entries = []
    for line in result.stdout.splitlines():
        commit_hash, message = line.split("\x1f", 1)
        entries.append({"hash": commit_hash, "message": message})
    return entries


def revert_to(directory: Path, commit_hash: str) -> None:
    """
    Restores the whole deck file to its state at commit_hash and records
    that as a new commit — a forward-moving revert, not history rewriting,
    consistent with how every other change here gets recorded.
    """
    _git(["checkout", commit_hash, "--", DECK_FILENAME], directory)
    commit(directory, f"Revert to {commit_hash[:7]}")


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


# --- protection ----------------------------------------------------------

def protect(path: Path) -> None:
    """
    Makes the real deck file read-only for the duration of a turn. This is
    the actual security boundary now — OpenCode's bash permission patterns
    do not reliably scope to a specific file. Confirmed directly: a
    `{"permission": "bash", "pattern": "*deck.pptx*", "action": "deny"}`
    rule, naming the exact protected filename, still let a matching
    command through and overwrite the file. An OS-level chmod can't be
    talked around the same way — verified against a raw bash redirect, a
    raw Python file write, and an actual python-pptx `Presentation.save()`
    call; all three raised a permission error, none silently succeeded.
    """
    path.chmod(0o444)


def unprotect(path: Path) -> None:
    path.chmod(0o644)


# --- rendering ---------------------------------------------------------------

def render_deck(
    directory: Path, deck_filename: str = DECK_FILENAME, output_prefix: str = "slide"
) -> list[Path]:
    """
    Renders every slide in the deck to its own PNG, returned in slide order.
    output_prefix lets a caller render two different versions of a deck
    (e.g. "before" and "after") into the same directory without one
    overwriting the other.
    """
    render_dir = directory / RENDER_DIRNAME
    render_dir.mkdir(parents=True, exist_ok=True)

    # The intermediate PDF lives in its own throwaway directory, not
    # render_dir — soffice always names it after the source file's stem
    # (e.g. "deck.pdf"), so two renders of the same deck running at once
    # (e.g. two overlapping turns against one session) would otherwise
    # collide on that exact path: one's cleanup unlinking the file out from
    # under the other's still-in-progress read. Confirmed this exact race
    # as the cause of a "No such file" crash during rendering. A unique
    # work dir per call makes the collision impossible regardless of why
    # two renders ended up running concurrently.
    with tempfile.TemporaryDirectory() as work_dir:
        pdf_path = _convert_to_pdf(directory / deck_filename, Path(work_dir))
        return _rasterize_pdf(pdf_path, render_dir, output_prefix)


def _convert_to_pdf(source: Path, work_dir: Path) -> Path:
    # -env:UserInstallation points soffice at a throwaway profile dir —
    # without it, two conversions running at once (e.g. two sessions
    # rendering at the same time) collide on the shared default profile
    # lock and one of them fails. Confirmed both the collision and the fix
    # by running two conversions concurrently before relying on this.
    with tempfile.TemporaryDirectory() as profile_dir:
        result = subprocess.run(
            [
                "soffice", "--headless",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to", "pdf",
                "--outdir", str(work_dir),
                str(source),
            ],
            capture_output=True, text=True, stdin=subprocess.DEVNULL,
        )
    if result.returncode != 0:
        raise RuntimeError(f"soffice pdf conversion failed:\n{result.stdout}{result.stderr}")
    pdf_path = work_dir / f"{source.stem}.pdf"
    if not pdf_path.is_file():
        raise RuntimeError(
            f"soffice reported success but {pdf_path.name} wasn't produced "
            f"(stdout: {result.stdout!r}, stderr: {result.stderr!r})"
        )
    return pdf_path


def _rasterize_pdf(pdf_path: Path, render_dir: Path, output_prefix: str) -> list[Path]:
    # Clear any previous run's images under this prefix — soffice's own
    # output name is fixed to the source's stem, but our per-slide names
    # are prefix-based and would otherwise accumulate across renders.
    for stale in render_dir.glob(f"{output_prefix}.*.png"):
        stale.unlink()

    doc = fitz.open(pdf_path)
    try:
        paths = []
        for i, page in enumerate(doc, start=1):
            image_path = render_dir / f"{output_prefix}.{i:03d}.png"
            page.get_pixmap(dpi=150).save(image_path)
            paths.append(image_path)
        return paths
    finally:
        doc.close()
