"""
Everything that treats a session's working directory as a slide deck:
git-backed version history, rendering slides to images via Marp, and
figuring out which slide(s) a given edit touched. Nothing here talks to
OpenCode — it only operates on files already sitting in a directory.
"""

import re
import subprocess
from pathlib import Path

DECK_FILENAME = "slides.md"
RENDER_DIRNAME = ".render"  # generated thumbnails — not part of the deck's own history

# Frontmatter is itself delimited by "---", so it has to be peeled off
# before we can split the rest of the file into slides on the same marker.
_FRONTMATTER_RE = re.compile(r"(?s)^---\s*\n(.*?)\n---\s*\n(.*)$")


# --- version history -------------------------------------------------------

def init_repo(directory: Path) -> None:
    """Turns a session's directory into its own git repo, if it isn't one yet."""
    if (directory / ".git").exists():
        return
    (directory / ".gitignore").write_text(f"{RENDER_DIRNAME}/\n.preview-*.md\n")
    _git(["init"], directory)
    _git(["config", "user.email", "cowork-ui@local"], directory)
    _git(["config", "user.name", "cowork-ui"], directory)
    commit(directory, "Initial deck")


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


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


# --- deck parsing ------------------------------------------------------------

def parse_deck(markdown: str) -> tuple[str, list[str]]:
    """Splits a Marp deck into its frontmatter and a list of slide bodies."""
    match = _FRONTMATTER_RE.match(markdown)
    if not match:
        raise ValueError("deck is missing Marp frontmatter ('--- ... ---' at the top)")
    frontmatter, body = match.groups()
    slides = re.split(r"(?m)^---\s*$", body)
    return frontmatter, [slide.strip() for slide in slides]


def affected_slides(old_markdown: str, new_markdown: str) -> list[int]:
    """0-based indices of every slide whose content differs between two deck versions."""
    _, old_slides = parse_deck(old_markdown)
    _, new_slides = parse_deck(new_markdown)
    count = max(len(old_slides), len(new_slides))
    return [
        i for i in range(count)
        if (old_slides[i] if i < len(old_slides) else None)
        != (new_slides[i] if i < len(new_slides) else None)
    ]


# --- rendering ---------------------------------------------------------------

def render_deck(directory: Path, deck_filename: str = DECK_FILENAME) -> list[Path]:
    """Renders every slide in the deck to its own PNG, returned in slide order."""
    render_dir = directory / RENDER_DIRNAME
    render_dir.mkdir(exist_ok=True)
    _run_marp(directory / deck_filename, render_dir / "slide.png", cwd=directory)
    return sorted(render_dir.glob("slide.*.png"), key=_slide_number)


def render_slide_preview(
    directory: Path, frontmatter: str, slide_markdown: str, name: str
) -> Path:
    """
    Renders one slide's markdown, with the deck's own frontmatter reattached,
    to a single PNG. Used to show a slide's before/after state for approval
    without touching the real deck file.
    """
    # Written into the deck's own directory (not .render/) so any relative
    # asset paths the slide references — e.g. an image — still resolve.
    source = directory / f".preview-{name}.md"
    source.write_text(f"---\n{frontmatter}\n---\n\n{slide_markdown}\n")
    try:
        render_dir = directory / RENDER_DIRNAME
        render_dir.mkdir(exist_ok=True)
        output = render_dir / f"{name}.png"
        _run_marp(source, output, cwd=directory)
        return render_dir / f"{name}.001.png"
    finally:
        source.unlink()


def _run_marp(source: Path, output: Path, cwd: Path) -> None:
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
