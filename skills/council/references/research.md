# Research pass

Research sits between round one and round two. In round one, panelists argue from principle and ask for the facts that would change their view. The Chair collects those requests, runs the research, and feeds the findings to everyone before round two. This ordering matters: it keeps round one opinionated and fast, and it makes round two about evidence instead of vibes.

## What to research

Take the `open_questions` each panelist returned in round one. Merge duplicates. Keep the five to eight that would most change the panel's advice. Typical categories:

- Market facts: typical pricing, margins, churn, CAC in the user's category.
- Precedents: a company that did the same thing, and what happened.
- Regulatory or platform constraints that would block the plan.
- Timing signals: a trend, a competitor move, a rate change.
- The user's own claims, if a public fact can check them.

## How to research

- Use the web tools you have. Prefer primary sources (company filings, pricing pages, official statistics) and recognized industry reports over blog posts repeating them.
- Note the publication date. A 2021 benchmark may not describe 2026.
- Two to three searches per question is enough. If nothing credible turns up, say so in the `research` array with `"source": "no credible source found"` so the panel knows it is arguing from principle on that point.
- Never fabricate a statistic or a URL. A council that cites a made-up number is worse than one that admits it does not know.
- Prefer a URL a reader can open without a form. A gated download or a "thank you" landing page is a weak citation; find the article that quotes the number, or say the figure comes from a gated report.

## How findings are used

Each research entry has `requested_by` (who asked) and gets a short id. In round two, panelists cite findings by saying what the finding is, in plain language, not by id. The PDF has a Sources section listing every entry with its URL. The replay page shows a small "sourced" marker on turns that cite research.

If the user turned research off (`--no-research` or said so), skip this pass, set `meta.research` to false, and have the Chair note in round two's intro that the panel is arguing from principle only.
