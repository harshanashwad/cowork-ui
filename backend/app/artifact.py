"""
Everything that treats a session's working directory as a slide deck:
git-backed version history and rendering slides to images via Marp.
Nothing here talks to OpenCode — it only operates on files already
sitting in a directory.
"""

import re
import subprocess
from pathlib import Path

DECK_FILENAME = "slides.md"
DECK_COPY_FILENAME = "slides_copy.md"  # scratch draft an agent's turn edits freely; see ws.py
RENDER_DIRNAME = ".render"  # generated thumbnails — not part of the deck's own history

# Frontmatter is itself delimited by "---", so it has to be peeled off
# before we can split the rest of the file into slides on the same marker.
_FRONTMATTER_RE = re.compile(r"(?s)^---\s*\n(.*?)\n---\s*\n(.*)$")


# --- version history -------------------------------------------------------

def init_repo(directory: Path) -> None:
    # Turns a session's directory into its own git repo, if it isn't one yet.
    if (directory / ".git").exists():
        return
    # Generated thumbnails and the in-progress scratch draft aren't real deck
    # content — the draft only ever gets into the real history by being
    # merged over slides.md (see ws.py's approval flow), never committed itself.
    (directory / ".gitignore").write_text(f"{RENDER_DIRNAME}/\n{DECK_COPY_FILENAME}\n")
    _git(["init"], directory)
    _git(["config", "user.email", "cowork-ui@local"], directory)
    _git(["config", "user.name", "cowork-ui"], directory)
    commit(directory, "Initial deck") # baseline snapshot of the deck


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


# --- deck parsing ------------------------------------------------------------

def parse_deck(markdown: str) -> tuple[str, list[str]]:
    """Splits a Marp deck into its frontmatter and a list of slide bodies."""
    # Peeling off frontmatter (first two '---' and the content wrapped in it)
    match = _FRONTMATTER_RE.match(markdown)
    if not match:
        raise ValueError("deck is missing Marp frontmatter ('--- ... ---' at the top)")
    frontmatter, body = match.groups() # body is remaining content in the markdown after frontmatter
    slides = re.split(r"(?m)^---\s*$", body) # split on '---' markers to get slides
    return frontmatter, [slide.strip() for slide in slides] # return frontmatter and list of slide texts


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
    render_dir.mkdir(exist_ok=True)
    _run_marp(directory / deck_filename, render_dir / f"{output_prefix}.png", cwd=directory)
    return sorted(render_dir.glob(f"{output_prefix}.*.png"), key=_slide_number)


def _run_marp(source: Path, output: Path, cwd: Path) -> None:
    '''
    the subprocess is equivalent to running the following command:
    marp slides.md --images png -o .render/slide.png --allow-local-files
    
    --images png — tells Marp to render each slide as a separate PNG (as opposed to one combined PDF/HTML)
    --allow-local-files — lets Marp load local image assets (like assets/chart.png) that the deck's markdown references — without this flag Marp blocks local file access for security reasons by default
    '''
    result = subprocess.run(
        [
            "marp", str(source.relative_to(cwd)),
            "--images", "png",
            "-o", str(output.relative_to(cwd)),
            "--allow-local-files",
        ],
        cwd=cwd,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,  # marp waits on stdin instead of erroring if this is left open
    )
    if result.returncode != 0:
        raise RuntimeError(f"marp render failed:\n{result.stdout}{result.stderr}")


def _slide_number(path: Path) -> int:
    # marp names multi-slide output "slide.001.png", "slide.002.png", ...
    return int(path.stem.split(".")[-1])
