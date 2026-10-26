# Council Boardroom

A live pane for the [Council](https://github.com/Tribespencer/council) skill. While `/council` runs, the boardroom sits beside the chat and redraws itself: the five seats with their current stance, who is on the Red Team, the round in progress with each panelist's pull quote, and finally the verdict with the council's averages, the dissent, and buttons that open the replay and the PDF.

## How it works

The Council skill writes `session.json` after each round. This mod watches for that file (any Write, Edit, or Bash command that touches a `session.json`) and parses it leniently, so a partial file mid-debate draws fine. The skill can also call the `update` tool the mod registers, passing the path, to force a redraw.

## Commands

- `/boardroom` opens the pane.
- `/boardroom /path/to/session.json` loads a finished run, for demos and screen recordings.

Typing `/council ...` opens the pane on its own, showing "the council is convening" until round one lands.

## Install

At the prompt of a terminal session:

```
/plugin install council-boardroom --marketplace Tribespencer/council
```

Needs the Council skill installed to have anything to show.
