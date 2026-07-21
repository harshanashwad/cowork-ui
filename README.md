# ppt cowork

A chat-based AI assistant with a Cowork UI, built specifically for collaboratively editing a PowerPoint decks (.pptx files). You talk to it in plain language, watch it work in real time, and approve or reject each round of changes before they land — on a real `.pptx` file the whole time.

This README covers getting it running and a guided first walkthrough. This repo contains a demo deck **demo_slide_deck.pptx** you can use to test the range of operations possible. For how it's actually built underneath — the agent bridge, the review mechanism, the tradeoffs — see [ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

- **Python 3.11+**
- **Node 20+**
- **[OpenCode](https://opencode.ai)** installed and on your `PATH` (`opencode --version`
should print something). The backend launches `opencode serve` itself as
a subprocess — you don't need to start it separately.
- **LibreOffice** (specifically the `soffice` binary on your `PATH`) —
this is required, not optional. It's how the deck gets rendered to
images for the thumbnail rail and the before/after review cards.
- **git** — every session's working directory is its own git repo; this
is how version history and revert are implemented, not a nice-to-have.

## Setup

### Backend

```bash
cd backend
python3 -m venv .venv        # optional, but recommended
source .venv/bin/activate
pip install -r requirements.txt
```

Add a `.env` file at the **repo root** (not inside `backend/`):

```
OPENAI_API_KEY=sk-...
```

See the sidenote at the bottom of this file — the app doesn't actually
need this key to run today, but it's read into the OpenCode subprocess's
environment on startup and it's the natural place to put it if you switch
the configured model to one that does need it.

Start the backend from the `backend/` directory:

```bash
uvicorn app.main:app --port 8000
```

Leave this running. On startup it launches `opencode serve` itself in the
background — if that fails (see Troubleshooting), the backend will refuse
to start.

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

This starts the Vite dev server on `http://localhost:5173`, which proxies
`/api` and `/ws` through to the backend on `:8000`. Both processes need to
be running at the same time — the frontend is not useful on its own.

Open **[http://localhost:5173](http://localhost:5173)** in a browser.

## Troubleshooting

- **Blank page / stuck on "Starting session..."** — the backend isn't
reachable. Check the backend terminal for errors; a common cause is
`opencode serve` failing to start (see below).
- **Backend fails on startup / hangs waiting for OpenCode** — confirm
`opencode` is actually on `PATH` (`which opencode`) and that nothing else
is already bound to port `4096` (OpenCode's own server port; override
with the `OPENCODE_PORT` env var if needed).
- **Renders never show up / errors mentioning `soffice`** — LibreOffice
isn't installed or `soffice` isn't on `PATH`. Confirm with
`soffice --version`.
- **Port already in use** — `:8000` (backend) or `:5173` (frontend) may
already be bound by a previous run; stop that process or change the port
(`uvicorn ... --port <other>` and update `frontend/vite.config.ts`'s
proxy target to match).
- **Agent never responds / times out** — this almost always means OpenCode
itself can't reach its model provider. Check the backend terminal output
for the error OpenCode returned.

## Walkthrough

Once both servers are running and the page loads, here's a natural
first pass through everything the app does.

**1. Start a session and load a deck.** A new session opens automatically
and starts empty. Click the attach (paperclip) button in the chat input
and upload a `.pptx` file — this becomes the deck for that session. The
`demo_slide_deck.pptx` bundled at the repo root is built specifically to
exercise the range of edits below (text, images, tables, charts,
cross-slide structure), so it's the easiest way to try everything in one
pass.

**2. The thumbnail rail.** Once the deck loads, a row of slide thumbnails
appears across the top. Click any one to preview it larger. This is pure
navigation — it always shows whatever the deck currently looks like right
now. It's not a history of changes; that's a separate panel (step 6).

**3. Ask for something, and watch it work.** Type a request in plain
language and send it. The activity feed shows the agent's work live: its
own explanation of what it's doing, plus collapsed entries for each
command it runs or file it touches (click one to expand and see exactly
what it did, if you're curious). A few concrete things worth trying
against the demo deck, each exercising something different:

- **Tone/content rewrite** — *"Rewrite the Executive Summary on slide 3
  to sound more confident and investor-facing, without changing the
  actual numbers."*
- **Image move + shape-targeting** — *"Move the photo on slide 7 to the
  right side of the slide, and expand the text next to it to also
  mention our new hire onboarding program."*
- **Table edit** — *"Add a new row to the Customer Highlights table on
  slide 8 for a customer called Norwood Logistics, with plausible values
  matching the other rows."*
- **Structural, cross-slide edit** — *"Split slide 9's risks into two
  separate slides — one for supply chain risks, one for everything else
  — expand some content on both slides — and update the agenda on
  slide 2 to reflect the new slide count."*

**4. Review the change.** When the agent finishes, a review card appears
with the affected slide(s) rendered before and after, side by side.
Nothing has actually changed yet — **Approve** merges the edit into the
real deck; **Reject** discards it entirely, as if it never happened.
Either way, the deck stays exactly as it was until you decide.

**5. Chart from a CSV.** As its own distinct trick: attach a `.csv` file
the same way you'd attach anything else, then ask for a chart from it.
The bundled `quarterly_revenue.csv` pairs with the deck's existing
"Quarterly Revenue by Region" slide — try *"I've uploaded
quarterly_revenue.csv. Add a new slide after slide 5 with a line chart
showing the revenue trend by region across the quarters."* The agent
reads the actual numbers from the file and places a real, editable
PowerPoint chart on the slide, positioned to avoid whatever's already
there.

**6. Version history.** The panel on the right (toggle it with the clock
icon) lists every approved change as its own entry, newest first, each
with a short auto-generated summary of what it did. **Revert to here**
restores the deck to that point — recorded as a new entry itself, so
you can always come back forward again. **Hide** just declutters the
list visually; it doesn't delete anything.

**7. Export.** Whenever you're happy with where the deck is, use
**Export .pptx** above the thumbnail rail to download it — a real,
normal PowerPoint file, openable anywhere.

---

**Sidenote on the model in use:** the app currently talks to OpenCode's
own bundled "OpenCode Zen" provider using one of its free-tier models
(`big-pickle`) — hardcoded in `backend/app/sessions.py`, used both when a
session is created and on every message sent. This requires no login or
API key at all, which is why the app works out of the box with nothing
but the `opencode` CLI installed. Getting here took a few swaps: `hy3-free`
was retired outright by the provider, `north-mini-code-free` was too slow
to make real progress on a turn, and `openai/gpt-4o-mini` (tried directly
via the `OPENAI_API_KEY` below) ran fine but didn't reliably follow the
exact filename instructions in the system prompt. Zen's free-tier lineup
does change over time; if the agent starts failing every turn with a
`ProviderModelNotFoundError`, run `opencode models opencode` to see the
current lineup and update `MODEL_ID` accordingly. The `OPENAI_API_KEY` in
`.env` is loaded into OpenCode's environment on startup but isn't
currently read by anything — it's there for if you point the hardcoded
provider/model at OpenAI
directly instead, not because the app depends on it today.