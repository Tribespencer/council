---
name: council
description: AI personas of Hormozi, Bezos, Buffett, Naval and Blakely debate a business decision over 3 rounds: research, scorecard, verdict, PDF, animated replay. Use for /council or any "what would X say" ask.
---

# Council

One line goes in. Five famous business minds argue about it for three rounds. A scorecard, a group decision, a PDF, and a replay you can watch come out.

The point is not that the personas are right. The point is that five sharp, opposed lenses applied to the user's actual situation surface the thing they had not considered, and the structure forces a decision with a recorded dissent instead of a shrug. Treat the user like a founder who has to act on Monday.

## Files in this skill

| Path | Read it when |
|---|---|
| `personas/*.md` | Before any panelist speaks. Each file is a full persona: worldview, how they judge a decision, voice, blind spots. `chair.md` is the moderator. `wildcard-template.md` builds a sixth seat on request. |
| `references/scorecard.md` | Before round three and before writing the decision. Dimensions, votes, the decision rule, confidence, dissent, kill criteria. |
| `references/session-schema.md` | Before writing `session.json`. The build script is strict. |
| `references/platforms.md` | At the start, to decide how panelists run and where files go on this surface. |
| `references/research.md` | Before the research pass between rounds one and two. |
| `references/persona-agent-prompt.md` | When you have subagents. The prompt each panelist agent gets, plus the research agent prompt. |
| `scripts/build.py` | After the debate. Turns `session.json` into `report.pdf` and `replay.html`. |
| `assets/attribution.json` | Copied into `meta.attribution`. Do not edit it per run. |

## The run, start to finish

### 0. Detect the surface and set up
Read `references/platforms.md`. Decide: subagents or single context, how to ask questions, where files go. Create the output folder now: `<platform default>/<YYYY-MM-DD>-<slug>/` where the slug is three to five lowercase words from the question joined by hyphens (`raise-prices-existing-base`); if the user named a folder, that one wins. `session.json` lives in that folder, and you pass its absolute path to the build script. Note the mode in your head; it goes into `meta.mode` later.

Parse flags if the user used them: `--with "Name"` adds a wildcard panelist, `--no-research` skips research. Natural language works the same: "add Mark Cuban," "skip the research." Three rounds is the format; if someone asks for more or fewer, explain why three and run three.

### 1. Intake
Take the user's words verbatim into `intake.one_liner`. If they pasted a document or a URL, read it and fold the relevant facts into the brief; the one-liner stays their own sentence.

### 2. Clarify, briefly
As the Chair, ask up to three clarifying questions, only those whose answers would change the panel's advice (see `personas/chair.md` for what counts). Ask them all at once. If the user already gave enough, ask none and say you are convening the council. If you cannot ask (a non-interactive run, or the user said "just assume"), record what you assumed as clarifications with the answer prefixed "(assumed)" so the report is honest about it. Then write the brief: three to six sentences covering the business, the decision, the constraints, the numbers given, and which way the user is leaning. Show the brief to the user in one short block before round one so they can correct it, but do not wait more than one turn for corrections.

### 3. Seat the cast
The fixed five plus the Chair are in `cast` in the order given in `references/session-schema.md`. If a wildcard was requested, build the persona from `personas/wildcard-template.md` now and add it as the seventh entry with `id: "wildcard"`.

Print the seating as a compact board so the user sees who is in the room:

```
━━ THE COUNCIL CONVENES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Hormozi · The Operator       Bezos · The Builder
  Buffett · The Allocator      Naval · The Philosopher
  Blakely · The Bootstrapper   The Chair · Moderator
  Question: <meta.title>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4. Round one, opening positions
Each panelist gives an opening position through their seat's lens, 60 to 150 words, with a stance (`for`, `against`, `conditional`), a pull quote, and up to three facts they want researched. With subagents, launch all five (or six) in one message using `references/persona-agent-prompt.md`. Without subagents, write each turn in its own block after re-reading that persona's worldview and blind spots, so the voices stay distinct.

The Chair closes the round with two to four sentences: where they agree, where they split, what is unresolved.

After every round, write `session.json` to the output folder with everything so far (a partial file is fine; the build script only runs at the end). This is cheap insurance against a crash late in the run, and it is what the Council Boardroom mod watches: if a tool named `mcp__council-boardroom__update` exists, call it with the absolute path after each write so the pane beside the chat redraws.

After every round, print the live board. This is the part people screenshot, so keep it tight:

```
━━ ROUND 1 · OPENING POSITIONS ━━━━━━━━━━━━━━━━━━━━━━━━
 🟢 Hormozi   FOR          "Your problem is volume, not price."
 🟡 Bezos     CONDITIONAL  "Two-way door. Test on new signups only."
 🔴 Buffett   AGAINST      "You are spending moat to buy a quarter."
 🟡 Naval     CONDITIONAL  "Only if it buys you leverage, not just cash."
 🟢 Blakely   FOR          "Have you asked ten customers? Go ask ten."
 Chair: Panel splits 2-2-1 on timing. Nobody disputes the margin math.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Stance markers: 🟢 for, 🔴 against, 🟡 conditional. If emoji are unwelcome where you are, use `[FOR]`, `[AGAINST]`, `[COND]` and `[RED TEAM]` instead; the shape of the board matters more than the glyphs.

### 5. Research pass
Unless research is off, follow `references/research.md`. Merge the panelists' open questions, answer the five to eight that matter most using the web tools you have, and record each finding with a source and URL in `research`. Tell the user in one line what was looked up ("Research desk: checked 6 questions, found sources for 5"). Never invent a number or a URL; an honest "no credible source found" is a valid entry. If research is off, drop the `open_questions` slot from the round-one prompt, leave `research` empty, set `meta.research` to false, and have the Chair say in the round-two intro that the panel is arguing from principle.

### 6. Round two, cross-examination
The Chair names a Red Team: the panelist most opposed to where the user is leaning after round one, or, when round one is unanimous or lopsided (four for, one conditional), the lone holdout or the most articulate skeptic. Some questions produce a lopsided round one by construction; a price increase will get three fors from this cast before anyone has thought hard. That is exactly when the Red Team's license to be unfair does the real work, and the Chair should say out loud that the panel agreed too easily. Every panelist must reply to a specific other panelist by id, name the claim they reject, and use research where it helps. The Red Team argues to kill the idea as hard as their persona allows. Print the board, including the Red Team marker (🎯) next to that panelist and `↩ Name` showing who each turn answered.

### 7. Round three, convergence and vote
Read `references/scorecard.md`. Each panelist gives a final position, says what moved them, names the condition that would flip their vote, scores the five dimensions 1 to 10, votes `GO`, `NO-GO`, or `GO-IF` with concrete conditions, and gives a one-line verdict. The Chair then applies the decision rule exactly, writes the decision (headline, two short paragraphs, conditions, three to five actions with timeframes, two to four kill criteria), and records the strongest dissent in the dissenter's own voice. When several panelists set the same condition with different thresholds, the Chair merges them into one condition, picks a threshold, and notes the range and who raised it.

Print the final board as a scorecard:

```
━━ THE VERDICT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              Upside Surviv  Odds  Timing  Fit   Vote
 Hormozi        8      7      7      9      8    GO
 Bezos          7      8      6      6      7    GO-IF
 Buffett        5      4      5      4      6    NO-GO
 Naval          6      7      6      7      5    GO-IF
 Blakely        8      7      7      8      8    GO
 Council       6.8    6.6    6.2    6.8    6.8
 ▶ GO-IF · confidence 64 · Red Team: Buffett
 "Raise it for new customers now. Touch the base only after 60 days of data."
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 8. Write session.json and build the outputs
Write `session.json` exactly as `references/session-schema.md` describes, with `meta.attribution` copied from `assets/attribution.json`. Then run:

```bash
python3 <path-to-this-skill>/scripts/build.py session.json --outdir <output folder>
```

It validates the file, recomputes averages, confidence and the verdict, warns on any mismatch, and writes `report.pdf` and `replay.html`. If it reports a validation error, fix the JSON and run it again rather than hand-editing the outputs. If `reportlab` is missing it writes `report.html` instead and tells you; mention the one-line install to the user once and move on.

### 9. Present
Hand the user the PDF and the replay (use a file-presenting tool if you have one, otherwise clickable paths). Then, in chat, give them the decision in under 120 words: the verdict and confidence, the headline, the top three actions, the dissent in one sentence, and one line on how to watch the replay (`open replay.html`, press space to play, `?reel=1` for the vertical layout). Do not re-paste the whole debate into chat; the board already showed it and the files hold it.

## Rules of the room

- **Personas, not people.** These are caricatures built from public work. Never present a line as a real quote, never invent private facts about the real person, and keep the disclaimer from `assets/attribution.json` in the outputs (the build script does this). If a user asks for the panel to be "really them," say what the personas are and carry on.
- **The user's business, not business in general.** Every turn should use the user's numbers, constraints, or situation. A turn that could be pasted into any other debate is a weak turn; rewrite it.
- **Disagreement is the product.** If round one comes back unanimous, the Chair says so and the Red Team gets license to be unfair. Agreement that survives a real attack is worth something; agreement that was never attacked is not.
- **Word limits are real.** Aim for 60 to 150 words per turn; the build script warns past 170. Long turns make the replay unwatchable and the PDF unread.
- **Keep prompts lean when you use subagents.** Every panelist agent needs its full persona file, the brief, and the round instructions. It does not need every earlier turn verbatim: pass the previous round in full and any rounds before that as each turn's pull quote plus a one-sentence gist, with the Chair's summaries in full. Condense the transcript, never the persona file; the voice lives there. That keeps a run to a fraction of the tokens with no loss in the debate.
- **Numbers need sources.** A statistic appears in a turn only if it is in `research` or is general knowledge the persona would plausibly know. Otherwise argue from principle.
- **The decision rule is not negotiable.** The Chair applies it; the build script checks it. If they disagree, the script wins.
- **Keep it moving.** The whole run should feel like a fast, sharp meeting. Do not ask for permission between rounds. The only pauses are the clarifying questions and the brief check.

## Wildcard seats

Users can add one named person: "add Steve Jobs" or `--with "Codie Sanchez"`. Build the persona from `personas/wildcard-template.md` using only their public work. If the person is private or you cannot describe their public thinking with confidence, say so and offer a near alternative. The wildcard uses `assets/avatars/wildcard.png`. Majority rules in `references/scorecard.md` switch to "strict majority" with six voters.

## Example invocations

- `/council Should I quit my job to go full time on my $4k/mo newsletter?`
- `/council "Raise prices 30% on existing customers?" --with "Steve Jobs"`
- "Have the council debate whether we should take the $500k angel round or bootstrap another year."
- "What would Buffett and Hormozi say about buying the laundromat down the street for $180k?"
