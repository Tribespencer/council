# Scorecard and decision rule

The scorecard exists so the council's conclusion is a number the user can argue with, not a vibe. Every panelist fills it in round three, after hearing everyone else. The Chair never scores.

## Dimensions

Each panelist scores all five dimensions from 1 to 10. Higher is always better for doing the thing.

| id | Label | 1 means | 10 means |
|---|---|---|---|
| `upside` | Upside | Even if it works, it barely matters | Changes the trajectory of the business |
| `survivability` | Survivability | The realistic worst case could kill the business | The worst case is a rounding error |
| `odds` | Odds | Almost certain to miss the plan | Very likely to work roughly as planned |
| `timing` | Timing | Wrong moment; wait or too late | Now is clearly the moment |
| `fit` | Fit | Far outside this founder's and team's strengths | Plays directly to what they are already good at |

`composite` for a panelist is the mean of their five scores. The council's `averages` are the mean of each dimension across panelists, and `council_composite` is the mean of panelist composites.

## Votes

Each panelist casts exactly one vote: `GO`, `NO-GO`, or `GO-IF`. A `GO-IF` vote must come with one to three concrete conditions. "Do more research" is not a condition; "run it with the 20 newest customers for 30 days before touching the base" is.

## Decision rule (the Chair applies this; `scripts/build.py` checks it)

1. **Ruin veto.** If the council's average `survivability` is below 4.0, the verdict cannot be `GO`. The best it can be is `GO-IF`, and the conditions must address the survivability concern.
2. **GO** when at least three of five panelists vote `GO` and `council_composite` is 6.5 or higher.
3. **NO-GO** when at least three panelists vote `NO-GO`.
4. **GO-IF** when `GO` plus `GO-IF` votes form a majority but rule 2 did not fire, or when rule 1 downgraded a `GO`. The conditions are the union of the panelists' conditions, deduplicated and ordered by how many panelists raised them.
5. **SPLIT** when none of the above produces a majority. Do not manufacture a consensus. Record both camps fairly and propose the smallest reversible experiment that would settle the disagreement.

With a sixth wildcard panelist, replace "three of five" with "a strict majority."

## Confidence

`confidence` is a number from 0 to 100 that tells the user how much the panel actually agreed, computed as:

```
vote_share   = votes for the verdict family / total votes      (GO-IF counts for GO-IF and SPLIT; GO counts for GO)
spread       = standard deviation of panelist composites        (0 to about 3 in practice)
confidence   = round(100 * vote_share * max(0, 1 - spread / 5))
```

`scripts/build.py` recomputes this from the scores. If the Chair's number disagrees, the script's number wins and a warning is printed.

## Dissent

Record the strongest dissent even when the verdict is unanimous in direction. The dissent is the single most useful paragraph in the report, because it is the thing the user will wish they had read if the decision goes wrong. Quote the dissenter in their own voice, 60 to 120 words.

## Kill criteria

The decision must include two to four observable signals that would mean the decision was wrong and should be reversed. Each has a metric or event and a time window. "Revenue drops" is not a kill criterion. "Churn in the first 60 days exceeds 8 percent against a 5 percent baseline" is.
