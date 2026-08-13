// Fable-as-judge: grades a captured itinerary on the dimensions that
// deterministic checks cannot reach — specificity, trip shape, request fit.
//
// Uses claude-fable-5 with structured output (output_config.format), so the
// grade arrives as validated JSON. Thinking is always on for Fable and must not
// be configured; sampling params are not accepted. A refusal fallback is
// enabled by default (`fallbacks: "default"`) so a stray safety decline
// degrades to an Opus-graded run instead of a lost one — set
// EVAL_JUDGE_FALLBACK=off to disable.

const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dimensions", "overall", "wouldShip", "topProblems", "bestMoment"],
  properties: {
    dimensions: {
      type: "object",
      additionalProperties: false,
      required: ["specificity", "groundedness", "tripShape", "requestFit", "diningIntegrity", "actionability"],
      properties: Object.fromEntries(
        ["specificity", "groundedness", "tripShape", "requestFit", "diningIntegrity", "actionability"].map(k => [
          k,
          {
            type: "object",
            additionalProperties: false,
            required: ["score", "evidence", "issues"],
            properties: {
              score: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
              evidence: { type: "array", items: { type: "string" } },
              issues: { type: "array", items: { type: "string" } },
            },
          },
        ]),
      ),
    },
    overall: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    wouldShip: { type: "boolean" },
    topProblems: { type: "array", items: { type: "string" } },
    bestMoment: { type: "string" },
  },
};

const RUBRIC = `You are grading a machine-generated travel itinerary the way a senior human travel planner reviews a junior's finished draft. You are strict: an itinerary that merely fills every slot with plausible content is a 5, not an 8. Rich means someone read THIS request and planned THIS trip.

Score each dimension 0-10. For every score, quote 1-3 short pieces of evidence from the itinerary itself (verbatim fragments), and list concrete issues. Do not average away problems: a single invented-looking restaurant or a day that ignores the request caps the relevant dimension at 4.

**specificity** — Apply the portability test to activity and dining descriptions: if a description would survive being moved to a different city unchanged ("charming local spot", "iconic landmark"), it fails. Rich descriptions say the reason for this place, at this hour, on this trip — the light, the dish, the connection to what came before. Score high only if most descriptions pass and the worst ones still carry something specific.

**groundedness** — Do establishment names read as real, checkable places (proper names, plausible for the destination) rather than inventions or category labels? Are URLs coherent with the place they claim to link? Do prices look like the destination's actual price level rather than generic ranges? You cannot browse; judge plausibility and internal consistency, and flag anything that smells fabricated.

**tripShape** — Arrival and final days lighter than the middle; no two consecutive days with identical rhythm; geography sane within each day (no city re-crossings); the thing the traveler most came for lands early enough that one bad-weather day cannot take it; transitions between bases treated as the day's spine, not squeezed between attractions.

**requestFit** — Read the traveler's request and expectations first, then check the itinerary against them line by line. Every explicit ask honored or its omission explained; nothing on the page that would prove nobody read the request (the exact canned inclusion this traveler was trying to avoid). A themed variant must show its theme in the day roster, not just the summary prose.

**diningIntegrity** — Meals match their period (no dinner house at breakfast); one real option beats two padded ones; repetition only where it reflects where the traveler actually sleeps (hut/ryokan/lodge half board, named as such); variety across days in cuisine, vibe, and neighborhood where the destination offers it.

**actionability** — Could the traveler book this trip from the page? Booking checklist carries real lead times; weather- or condition-dependent days name their fallback in transitNote; assumptions state what was uncertain; budget arithmetic roughly adds up against the stated per-day levels.

Set overall to your holistic grade (not a mean — weight what would matter most to this traveler). Set wouldShip=true only if you would hand this to a paying customer without edits. topProblems: the 1-3 changes that would most improve it. bestMoment: the single richest, most this-trip-specific thing on the page.`;

export async function judgeFixture(fixture, opts = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for judging");
  const model = opts.model ?? process.env.EVAL_JUDGE_MODEL ?? "claude-fable-5";
  const useFallback = (process.env.EVAL_JUDGE_FALLBACK ?? "on") !== "off";

  const userPrompt = `## The traveler's request
${JSON.stringify(fixture.request, null, 2)}

## What a good result was expected to look like for this persona
${fixture.expectations || "(no persona-specific expectations recorded)"}

## The generated itinerary to grade
${JSON.stringify(fixture.itinerary)}

Grade it against the rubric. Quote evidence verbatim from the itinerary.`;

  const body = {
    model,
    max_tokens: 8000,
    system: RUBRIC,
    messages: [{ role: "user", content: userPrompt }],
    output_config: { format: { type: "json_schema", schema: GRADE_SCHEMA } },
    ...(useFallback ? { fallbacks: "default" } : {}),
  };

  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    ...(useFallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
  };

  const maxAttempts = 3;
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, 2000 * attempt + Math.random() * 1000));
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      lastError = `${response.status} ${text.slice(0, 300)}`;
      if (response.status !== 429 && response.status < 500) throw new Error(`judge failed: ${lastError}`);
      continue;
    }
    const data = await response.json();
    if (data.stop_reason === "refusal") {
      throw new Error(`judge declined (category: ${data.stop_details?.category ?? "unknown"})`);
    }
    const text = (data.content ?? []).filter(b => b.type === "text").map(b => b.text).join("");
    const grade = JSON.parse(text);
    return { grade, model: data.model, usage: data.usage };
  }
  throw new Error(`judge failed after ${maxAttempts} attempts: ${lastError}`);
}
