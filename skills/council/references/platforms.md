# Running the council on each Claude surface

The debate is the same everywhere. What changes is how the panelists are run, how the user is asked questions, and where files end up. Detect the surface from the tools you have, not from guesses about the product name.

## Claude Code (terminal, desktop app, IDE)

Signals: you have an `Agent` (or `Task`) tool, `Bash`, `WebSearch`, and often `AskUserQuestion`.

- **Panelists are subagents.** For each round, launch one `Agent` per panelist in the same message so they run in parallel. Use `subagent_type: "general-purpose"` and give each the prompt from `references/persona-agent-prompt.md`. Each agent returns one JSON turn object. This is what makes the terminal worth filming: five agents spin up, think, and come back with different answers.
- **Research** runs as its own subagent between rounds one and two, with `WebSearch` and `WebFetch`, returning the `research` array.
- **Clarifying questions** go through `AskUserQuestion` when available, otherwise ask in chat and wait.
- **Files** go to `./council-output/<YYYY-MM-DD>-<slug>/`. Run `python3 <skill>/scripts/build.py session.json --outdir <that dir>` with `Bash`. If `reportlab` is missing, the script says so and still writes a print-ready `report.html`; offer `pip install reportlab` once, do not loop on it.
- **Present** the PDF and replay with `SendUserFile` if available, otherwise print the paths as clickable links.
- Set `meta.mode` to `multi-agent` and `meta.platform` to `claude-code`.

## claude.ai and Claude Desktop chat

Signals: no `Agent` tool; you have a code execution sandbox (bash or python tools) and `web_search`.

- **Panelists run in one context, strictly separated.** Write each panelist's turn in its own block, starting with the speaker's name, and do not let one persona's reasoning bleed into the next. Before writing a persona's turn, re-read its persona file section on worldview and blind spots so the voices stay distinct. Write round two turns in a shuffled order so the same panelist does not always speak last.
- **Research** uses `web_search` directly. Keep it to five to eight searches; attach each fact to a source.
- **Clarifying questions** are asked in chat. Ask all of them in one message and wait for the reply.
- **Files** go to `/mnt/user-data/outputs/council-<slug>/`. Copy the skill's `assets/` and `templates/` next to the script if the build script cannot find them, then run it with the sandbox's python. The PDF and HTML appear as downloadable files.
- Set `meta.mode` to `single-context` and `meta.platform` to `claude-ai`.

## Cowork

Signals: you have subagents and a filesystem but no interactive browser.

Run it like Claude Code. Write files to the working folder the user gave you and present them as links.

## Anything else

If you cannot run Python at all, still run the debate and write the full report as Markdown in chat using the same structure as the PDF (brief, three rounds, scorecard table, decision, dissent, kill criteria, sources). The debate is the product; the files are packaging.
