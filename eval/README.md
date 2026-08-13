# Itinerary Quality Eval

Automated eval for the `generate-itinerary` pipeline, judged by **Claude Fable 5**.
It answers one question on a recurring basis: *is the generator producing rich,
planned-for-this-traveler itineraries, or plausible filler?*

## Architecture

```
personas.json ──▶ capture.mjs ──▶ fixtures/*.json ──▶ run.mjs ──▶ results/scorecard.{md,json}
 (trip bank)      (hits the           (raw + parsed      ├─ checks.mjs   (deterministic, free)
                  deployed edge        outputs)          └─ judge.mjs    (Fable, rubric-graded)
                  function)
```

**Layer 1 — deterministic checks** (`checks.mjs`, free, instant): the hard rules
the generation prompt itself states, enforced as assertions — 3 periods per day,
1–3 activities, dining caps, `isPrimary` ordering, allowed tags, the
restaurant-repetition cap (lodging half-board exempt), category-description
dining names ("a lakeside trattoria"), banned generic phrases ("hidden gem"),
template/malformed URLs, `noFlight` contract, booking-checklist shape.
These target the failure modes production has actually produced (see the
comments in `supabase/functions/generate-itinerary/index.ts`).

**Layer 2 — Fable judge** (`judge.mjs`): grades what regexes can't, 0–10 per
dimension with verbatim evidence:

| Dimension | The question it asks |
|---|---|
| specificity | Do descriptions pass the **portability test** — would they survive being moved to another city? |
| groundedness | Do names/URLs/prices read as real, checkable, destination-priced? |
| tripShape | Lighter arrival/final days, alternating rhythm, sane geography, weather-resilient sequencing? |
| requestFit | Was *this* request read? Persona's explicit asks honored; canned inclusions absent; theme visible in the roster? |
| diningIntegrity | Meals match periods; repetition only where the traveler actually sleeps; real variety? |
| actionability | Bookable from the page — lead times, fallbacks in transitNotes, honest assumptions, budget that adds up? |

Each persona in `personas.json` carries an `expectations` string — the
persona-specific definition of "rich" — which is handed to the judge, so a
Dolomites hut trek is graded on rifugio half-board honesty and booking windows,
not on restaurant variety it shouldn't have.

## Running it

```sh
# 1. Generate fixtures against the deployed function (~2 min per persona, sequential)
SUPABASE_URL=... SUPABASE_ANON_KEY=... node eval/capture.mjs            # all personas
node eval/capture.mjs cdmx-food dolomites-hut                            # subset (falls back to .env)

# 2. Grade
ANTHROPIC_API_KEY=... node eval/run.mjs          # checks + Fable judge
node eval/run.mjs --no-judge                      # checks only, free
open eval/results/scorecard.md

# Self-test the deterministic layer (no network)
node eval/checks.test.mjs
```

Exit code is non-zero when any fixture has hard-rule failures or a judge
overall below `EVAL_MIN_OVERALL` (default 6), so CI reds on quality
regressions. `EVAL_JUDGE_MODEL` overrides the judge (e.g. `claude-opus-5` for
cheaper runs); `EVAL_JUDGE_FALLBACK=off` disables the refusal fallback.

## CI

`.github/workflows/itinerary-eval.yml` runs on manual dispatch and weekly
(Mondays), publishes the scorecard to the job summary, and uploads
fixtures + results as artifacts (90-day retention) so drift is diffable over
time. Required repo secrets:

- `EVAL_SUPABASE_URL`, `EVAL_SUPABASE_ANON_KEY` — the deployed project
- `ANTHROPIC_API_KEY` — for the judge

## Reading a scorecard

- **Check fails** are contract violations — the generator broke its own stated
  rules; fix the pipeline, not the threshold.
- **Judge dimensions below ~6** are richness regressions. `specificity` and
  `requestFit` are the canaries: they fall first when research comes back thin
  (Perplexity 429s) or when a prompt change makes output more generic.
- Cross-reference `stats` (unique restaurants, empty dining periods,
  category-name counts) between runs: an itinerary can pass every hard rule
  while quietly getting emptier — the judge catches that, the stats explain it.

## Known blind spots / next steps

- **Link liveness**: URLs are checked for shape, not resolution. A `HEAD`
  probe pass (rate-limited) would catch dead booking links.
- **Real-world truth**: the judge grades plausibility, not facts. Sampling a
  few named establishments per run through the existing `validate-links`
  function (or a search API) would catch confidently-named closed restaurants.
- **A/B on prompt changes**: capture fixtures before and after a prompt edit
  and diff scorecards; the persona bank is deliberately stable so runs compare.
- **Skeleton-complete mode**: when the plan pass emits full days, roster
  dedupe and the plan critique are both bypassed in the pipeline — worth a
  dedicated fixture if that mode shows up in `[timing] summary` logs.
