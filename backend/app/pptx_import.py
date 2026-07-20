"""
Loading an uploaded .pptx as the deck itself — no conversion. The agent
now edits deck.pptx directly as a real binary PowerPoint file (see
ws.py), so an uploaded presentation is used exactly as given.
"""

from pathlib import Path

from app.artifact import DECK_FILENAME


def import_pptx(pptx_bytes: bytes, directory: Path) -> None:
    (directory / DECK_FILENAME).write_bytes(pptx_bytes)
