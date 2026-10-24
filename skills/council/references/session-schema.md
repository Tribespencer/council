# session.json

Everything the council produces goes into one JSON file. The PDF and the replay page are built from it by `scripts/build.py`, so the file is the source of truth. Write it incrementally if you can (after each round), so a crash late in the run does not lose the debate.

All text fields are plain text. No Markdown inside strings except in `decision.summary`, where `**bold**` is allowed.

```jsonc
{
  "schema": "council/1",
  "meta": {
    "title": "Raise prices 30% on the existing base?",   // short, under 70 chars
    "question": "Should I raise prices 30% on existing customers for my $49/mo SaaS?",
    "date": "2026-10-23",
    "mode": "multi-agent",                 // or "single-context"
    "research": true,
    "platform": "claude-code",             // "claude-ai", "cowork", "other"
    "attribution": {                       // copied from assets/attribution.json
      "product": "Council",
      "name": "Spencer Tribe",
      "handle": "@Spencer.Ai.Tribe",
      "url": "instagram.com/spencer.ai.tribe"
    }
  },
  "intake": {
    "one_liner": "the user's original words, verbatim",
    "clarifications": [ { "q": "...", "a": "..." } ],   // if a question could not be asked, answer starts with "(assumed)" 
    "brief": "3 to 6 sentences the Chair wrote: the business, the decision, the constraints, what the user is leaning toward."
  },
  "cast": [
    { "id": "hormozi", "name": "Alex Hormozi", "seat": "The Operator",
      "tagline": "Offers, pricing, acquisition math", "avatar": "hormozi.png" },
    { "id": "bezos",   "name": "Jeff Bezos",   "seat": "The Builder", "tagline": "...", "avatar": "bezos.png" },
    { "id": "buffett", "name": "Warren Buffett", "seat": "The Allocator", "tagline": "...", "avatar": "buffett.png" },
    { "id": "naval",   "name": "Naval Ravikant", "seat": "The Philosopher", "tagline": "...", "avatar": "naval.png" },
    { "id": "blakely", "name": "Sara Blakely", "seat": "The Bootstrapper", "tagline": "...", "avatar": "blakely.png" },
    { "id": "chair",   "name": "The Chair",    "seat": "Moderator", "tagline": "Runs the room", "avatar": "chair.png" }
    // optional wildcard: { "id": "wildcard", "name": "Steve Jobs", "seat": "The Wildcard", "tagline": "...", "avatar": "wildcard.png" }
  ],
  "research": [
    { "id": "r1", "claim": "Median SaaS price increase in 2025 cohort studies was 8 to 12 percent",
      "source": "ProfitWell pricing report", "url": "https://...", "requested_by": ["hormozi"], "used_in_round": 2 }
  ],
  "rounds": [
    {
      "number": 1,
      "title": "Opening positions",
      "chair_intro": "one or two sentences",
      "red_team": null,                           // round 2 only: a cast id
      "turns": [
        { "speaker": "hormozi", "stance": "for",  // "for" | "against" | "conditional"
          "reply_to": null,                        // round 2+: cast id being answered
          "text": "the persona's words, 60 to 150 words",
          "pull_quote": "one punchy sentence from the text, under 90 chars" }
      ],
      "chair_summary": "two to four sentences"
    }
  ],
  "scorecard": {
    "dimensions": ["upside", "survivability", "odds", "timing", "fit"],
    "scores": {
      "hormozi": { "upside": 8, "survivability": 7, "odds": 7, "timing": 9, "fit": 8,
                   "vote": "GO", "conditions": [], "one_line": "Price is the cheapest lever you have. Pull it." }
      // one entry per panelist, never the chair
    }
    // averages, composites, and confidence are computed by scripts/build.py; you may include them, the script overwrites them
  },
  "decision": {
    "verdict": "GO-IF",                 // GO | NO-GO | GO-IF | SPLIT
    "confidence": 72,                   // recomputed by the script
    "headline": "Raise prices, but only on new customers first.",   // under 80 chars
    "summary": "two short paragraphs in the Chair's voice",
    "conditions": [ "..." ],            // required for GO-IF, optional otherwise
    "actions": [ { "text": "...", "when": "This week" } ],   // 3 to 5
    "kill_criteria": [ "..." ],         // 2 to 4, each with a metric and a window
    "dissent": { "speaker": "buffett", "text": "60 to 120 words in the dissenter's voice" },
    "split": null                        // for SPLIT only: { "camp_a": {"members": [...], "position": "..."}, "camp_b": {...}, "experiment": "..." }
  }
}
```

## Rules the build script enforces

- Every `speaker`, `reply_to`, `red_team`, `requested_by` and `dissent.speaker` must be a cast id.
- Round 2 turns must have a `reply_to`.
- Every non-chair cast member must have a scorecard entry with all five dimensions and a vote.
- `GO-IF` votes need at least one condition; a `GO-IF` verdict needs at least one condition.
- The verdict is checked against the decision rule in `references/scorecard.md`; a mismatch prints a warning and the report shows the computed verdict.
