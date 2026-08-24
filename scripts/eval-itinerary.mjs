#!/usr/bin/env node
// Quality checks for a generated itinerary, encoding the four reported failure
// modes documented in docs/itinerary-quality-criteria.md:
//
//   C1  repetitive days (duplicate activities across days; uniform day structure)
//   C2  disconnected days (location ping-pong across the trip)
//   C3  within-day proximity (stops scattered beyond the day's area)
//   C4  flat descriptions (generic labels, no why-this-why-now)
//
// Structural checks run offline on the itinerary JSON alone. C3 and the softer
// halves of C2/C4 need judgment, so `--judge` adds an LLM pass when
// ANTHROPIC_API_KEY is set. Exit code 1 when any check FAILs.
//
// Usage: node scripts/eval-itinerary.mjs <itinerary.json> [--judge]

import { readFileSync } from "node:fs";

const [, , filePath, ...flags] = process.argv;
if (!filePath) {
  console.error("Usage: node scripts/eval-itinerary.mjs <itinerary.json> [--judge]");
  process.exit(2);
}
const useJudge = flags.includes("--judge");
const itinerary = JSON.parse(readFileSync(filePath, "utf8"));

const days = (itinerary.days ?? []).filter(
  d => Array.isArray(d.periods) && d.periods.length > 0,
);
if (days.length === 0) {
  console.error("No generated days in this itinerary (all empty/locked?) — nothing to evaluate.");
  process.exit(2);
}

const results = [];
const report = (id, status, detail) => results.push({ id, status, detail });

// ── helpers ─────────────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "at", "on", "to", "for", "with",
  "walk", "visit", "explore", "tour", "stroll", "morning", "afternoon", "evening",
]);
const tokens = s =>
  new Set(
    String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w)),
  );
const jaccard = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};
const activitiesOf = day =>
  (day.periods ?? []).flatMap(p => p.activities ?? [])
    .filter(a => a?.name && !(a.tags ?? []).includes("transit"));

// ── C1a: duplicate / near-duplicate activities across days ──────────────────
{
  const entries = days.flatMap(day =>
    activitiesOf(day).map(a => ({
      day: day.dayNumber,
      name: a.name,
      toks: tokens(`${a.name} ${a.description ?? ""}`),
    })),
  );
  const dupes = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.day === b.day) continue; // same-day dupes are a different (rarer) bug
      const exact = a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
      if (exact || jaccard(a.toks, b.toks) >= 0.6) {
        dupes.push(`day ${a.day} "${a.name}" ≈ day ${b.day} "${b.name}"`);
      }
    }
  }
  report(
    "C1a cross-day activity repetition",
    dupes.length === 0 ? "PASS" : "FAIL",
    dupes.length ? dupes.join("; ") : `${entries.length} activities, no cross-day repeats`,
  );
}

// ── C1b: structural monotony ────────────────────────────────────────────────
{
  const counts = days.flatMap(d => (d.periods ?? []).map(p => (p.activities ?? []).length));
  const twos = counts.filter(c => c === 2).length;
  const uniformRate = counts.length ? twos / counts.length : 0;
  // A short trip can legitimately be uniform; only call it monotony with
  // enough days that variation should have appeared somewhere.
  const monotonous = days.length >= 4 && uniformRate > 0.9;
  report(
    "C1b uniform day structure",
    monotonous ? "FAIL" : "PASS",
    `${Math.round(uniformRate * 100)}% of ${counts.length} periods have exactly 2 activities` +
      (days.length < 4 ? " (trip too short to judge monotony)" : ""),
  );
}

// ── C2: location ping-pong across the trip ──────────────────────────────────
{
  const locs = days.map(d => String(d.location ?? "").trim().toLowerCase()).filter(Boolean);
  const revisits = [];
  const seen = new Map(); // location -> last day index it appeared
  locs.forEach((loc, i) => {
    if (seen.has(loc) && seen.get(loc) < i - 1) {
      // Returned to a location after having left it. The final day returning to
      // the first location (gateway city, for departure) is legitimate.
      const isFinalReturn = i === locs.length - 1 && loc === locs[0];
      if (!isFinalReturn) revisits.push(`day ${days[i].dayNumber} returns to "${days[i].location}"`);
    }
    seen.set(loc, i);
  });
  report(
    "C2 day-to-day continuity",
    revisits.length === 0 ? "PASS" : "FAIL",
    revisits.length ? revisits.join("; ") : `route: ${[...new Set(locs)].join(" → ")}`,
  );
}

// ── C4: description quality ─────────────────────────────────────────────────
{
  const GENERIC = [
    "hidden gem", "must-see", "must see", "a must", "iconic landmark",
    "charming local", "world-famous", "something for everyone", "a variety of",
    "vibrant atmosphere", "picturesque", "breathtaking views", "quaint",
  ];
  const descs = days.flatMap(d =>
    (d.periods ?? []).flatMap(p => [
      ...(p.activities ?? []).map(a => a.description ?? ""),
      ...(p.dining ?? []).map(x => x.description ?? ""),
    ]),
  ).filter(Boolean);
  const words = s => s.split(/\s+/).filter(Boolean).length;
  const mean = descs.reduce((n, d) => n + words(d), 0) / (descs.length || 1);
  const genericHits = descs.filter(d => GENERIC.some(g => d.toLowerCase().includes(g)));
  const thin = descs.filter(d => words(d) < 8).length;
  // Activity-type shorthand that assumes the reader already knows the sport.
  // Deliberately a short, precise list — a blanket all-caps check would flag
  // legitimate proper nouns (MAAT, MoMA) and airport codes in transit rows.
  const SHORTHAND = [
    { abbr: /\bMTB\b/i, plain: /mountain.bik/i },
    { abbr: /\bSUP\b/, plain: /paddle.?board/i },
    { abbr: /\bATV\b/, plain: /all.terrain|quad/i },
    { abbr: /\bUTV\b/, plain: /side.by.side|utility/i },
    { abbr: /\b4WD\b|\b4x4\b/i, plain: /four.wheel|off.road/i },
    { abbr: /\bXC\b/, plain: /cross.country/i },
  ];
  const jargonHits = [];
  for (const day of days) {
    for (const p of day.periods ?? []) {
      for (const a of p.activities ?? []) {
        const text = `${a.name ?? ""} ${a.description ?? ""}`;
        for (const { abbr, plain } of SHORTHAND) {
          if (abbr.test(text) && !plain.test(text)) {
            jargonHits.push(`day ${day.dayNumber} "${a.name}" uses shorthand with no plain-words explanation`);
          }
        }
      }
    }
  }
  const problems = [];
  if (jargonHits.length > 0) problems.push(jargonHits.join("; "));
  if (genericHits.length > 0) {
    problems.push(`${genericHits.length} generic phrase(s): ${genericHits.slice(0, 3).map(d => `"${d.slice(0, 60)}"`).join("; ")}`);
  }
  if (mean < 12) problems.push(`mean description length ${mean.toFixed(1)} words — one-liners, no room for why-this`);
  if (thin / (descs.length || 1) > 0.3) problems.push(`${thin}/${descs.length} descriptions under 8 words`);
  report(
    "C4 description quality (structural)",
    problems.length === 0 ? "PASS" : "FAIL",
    problems.length ? problems.join("; ") : `${descs.length} descriptions, mean ${mean.toFixed(1)} words, no generic phrases`,
  );
}

// ── C3 + nuance: LLM judge ──────────────────────────────────────────────────
async function judge() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    report("C3 within-day proximity (judge)", "SKIP", "no ANTHROPIC_API_KEY — structural checks only");
    return;
  }
  const compact = days.map(d => ({
    day: d.dayNumber,
    title: d.title,
    location: d.location,
    periods: (d.periods ?? []).map(p => ({
      label: p.label,
      activities: (p.activities ?? []).map(a => ({ name: a.name, description: a.description })),
      dining: (p.dining ?? []).map(x => x.name),
    })),
  }));
  const prompt = `You are auditing a travel itinerary against four quality criteria. Judge harshly, the way a local would.

C1 Repetition: do any two days feel like variations of each other, in content or rhythm?
C2 Continuity: do consecutive days relate geographically, or does the trip ping-pong between areas?
C3 Proximity: within each day, are the activities and the assigned restaurants plausibly near each other and ordered without backtracking? Name any day whose stops are scattered.
C4 Excitement and clarity: do descriptions say plainly WHAT each activity is — could a reader who has never heard of the sport, operator, or abbreviation follow it, the way an old-school travel agent would prescribe it? — and why each pick is right for this trip at that hour, rather than generic labels that would survive being moved to another city?

The itinerary:
${JSON.stringify(compact)}

Respond with ONLY JSON: {"scores": {"C1": 1-5, "C2": 1-5, "C3": 1-5, "C4": 1-5}, "failures": ["specific problem naming the day", ...]}. 5 = a knowledgeable local planned it; 3 = acceptable; 1 = clearly generated. An empty failures array is a normal outcome.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.EVAL_JUDGE_MODEL || "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    report("LLM judge", "SKIP", `API error ${res.status}`);
    return;
  }
  const data = await res.json();
  const raw = (data.content?.[0]?.text ?? "").replace(/```[a-z]*\n?/gi, "").trim();
  try {
    const parsed = JSON.parse(raw);
    const scores = parsed.scores ?? {};
    for (const c of ["C1", "C2", "C3", "C4"]) {
      const s = Number(scores[c]);
      report(`${c} (judge)`, s >= 3 ? "PASS" : "FAIL", `score ${s}/5`);
    }
    for (const f of parsed.failures ?? []) report("judge finding", "INFO", String(f));
  } catch {
    report("LLM judge", "SKIP", `unparseable judge response: ${raw.slice(0, 200)}`);
  }
}

if (useJudge) await judge();
else report("C3 within-day proximity (judge)", "SKIP", "run with --judge and ANTHROPIC_API_KEY for C3 and nuance checks");

// ── report ──────────────────────────────────────────────────────────────────
let failed = false;
for (const r of results) {
  if (r.status === "FAIL") failed = true;
  console.log(`${r.status.padEnd(4)} ${r.id}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS");
process.exit(failed ? 1 : 0);
