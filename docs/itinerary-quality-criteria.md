# Itinerary quality criteria

Four failure modes, reported from real generated itineraries, that every change to
`supabase/functions/generate-itinerary` must be checked against. They are encoded as
automated checks in `scripts/eval-itinerary.mjs` — run it on a generated itinerary JSON
before and after any prompt or pipeline change.

## C1 — Repetitive days

The days must not feel like variations of each other. Two forms:

- **Content**: the same activity (or a lightly reworded version of it) appearing on more
  than one day. Root cause history: days are written by parallel model calls that cannot
  see each other's output, so uniqueness must be decided in the one pass that sees the
  whole trip (the skeleton), never left to the day writers.
- **Structure**: every day carrying the same rhythm — e.g. exactly 2 activities in every
  period of every day. A planned trip has light days and full days; a uniform grid is
  the tell of a generated one.

## C2 — Disconnected days

Consecutive days should relate geographically: a trip that covers area A on day 1,
jumps to C on day 2, and returns to A on day 3 wastes travel time and reads as unplanned.
Day-to-day sequencing is decided in the skeleton's day roster; each day clusters around
a named area and consecutive days should be adjacent or on a sensible route. A return to
the gateway city for departure on the final day is legitimate and not a violation.

## C3 — Within-day proximity

Everything scheduled in one day — activities and the meals between them — should sit
within the day's area, ordered so the day moves through it without backtracking, the way
a local would route it. Dining must be chosen near where the traveler actually is at that
hour, not for variety's own sake. Proximity beats variety when they conflict.

## C4 — Activities that sell themselves

Each activity's description must say what it is *and* why it earned its place on this
trip for this traveler at this hour — not a generic label ("charming local spot",
"must-see") and not a bare utility line. If a description would survive being moved to a
different city or a different traveler's itinerary unchanged, it fails.

"What it is" means plain words, the way an old-school travel agent prescribed a trip:
a reader who has never heard of the sport, the operator, or the local shorthand must be
able to follow it. "Guided singletrack MTB" fails; "a guided mountain-bike ride on Mount
Currie's trail network" passes. Proper nouns are welcome in names, but the description
must spell out what kind of activity it actually is.

## Running the checks

```sh
# Structural checks only (no network, no keys):
node scripts/eval-itinerary.mjs path/to/itinerary.json

# Add an LLM judge pass for C2/C3/C4 nuance (needs ANTHROPIC_API_KEY):
ANTHROPIC_API_KEY=... node scripts/eval-itinerary.mjs path/to/itinerary.json --judge
```

The itinerary JSON is the parsed generation output (the `ItineraryData` shape in
`src/types/itinerary.ts`). Sources: a saved trip's content, an `itinerary_jobs.content`
row (concatenate the streamed deltas), or a local capture. Exit code is non-zero when
any check fails, so the script can gate CI or a manual smoke test.

## The live loop

`scripts/generate-live.mjs` runs a real generation against the deployed function
(connection from the repo `.env` or `SUPABASE_URL`/`SUPABASE_ANON_KEY`) and writes the
JSON the eval consumes:

```sh
node scripts/generate-live.mjs out.json && node scripts/eval-itinerary.mjs out.json --judge
```

`docs/workflows/itinerary-eval.yml` packages both as a manual-dispatch GitHub Actions
workflow — copy it to `.github/workflows/` to install (see the note in the file for why
it is parked here). Run it after any change to the generation prompts or pipeline.
