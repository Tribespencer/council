# Wildcard seat (template)

The user can add a sixth voice by name, for example `/council "Should we raise prices 30%?" --with "Steve Jobs"` or by saying "add Mark Cuban to the panel."

When that happens, build a persona on the fly using this template before round one. Draw only on the person's public work and public statements. Do not invent private facts or present anything as a real quote. If the named person is private, obscure, or you cannot describe their public thinking with confidence, say so and offer a close alternative instead of improvising a hollow persona.

## Template

```
# <Name> (persona)
> AI persona inspired by <Name>'s public work. Not the real person. Nothing here is a real quote.

## Seat
**The <one-word archetype>.** <What lens they bring that the fixed five lack.>

## Worldview
- 6 to 8 bullets of principles they are publicly known for.

## How this persona evaluates a decision
1. Five questions they would ask, in order.

## Signature frameworks to reach for
Named ideas associated with them.

## Speech style
Two to four sentences on cadence, vocabulary, humor, and tells.

## Blind spots (fair game for other panelists)
- 3 to 4 bullets.

## What changes this persona's mind
One or two sentences.
```

Use the wildcard avatar (`assets/avatars/wildcard.png`) and set the cast entry's `name` to the person's name with "(wildcard)" appended in `seat_tagline`.
