// Deterministic quality checks for a generated itinerary.
//
// These encode the contract the generation pipeline already states in its own
// system prompt (supabase/functions/generate-itinerary/index.ts): structure,
// dining integrity, description discipline, URL hygiene. They are free and
// instant, so they run on every fixture before any model-judged scoring.
//
// Each check returns findings: { check, level: "fail" | "warn", detail }.
// "fail" = the output violates a hard rule the prompt states.
// "warn" = a richness smell worth counting but defensible in context.

const ALLOWED_TAGS = new Set([
  "transit", "cultural", "nature", "hiking", "beach", "food", "photo-worthy",
  "walking", "adventure", "relaxation", "shopping", "nightlife",
]);

const PERIOD_LABELS = ["Morning", "Afternoon", "Evening"];

// Phrases the system prompt explicitly bans as descriptions that "would fit any
// comparable place".
const GENERIC_PHRASES = [
  "hidden gem", "charming local", "iconic landmark", "must-see", "a must see",
  "must-visit", "bucket list", "world-famous", "picturesque town",
  "something for everyone", "vibrant atmosphere", "rich history and culture",
];

// A dining "name" that is a category description rather than an establishment:
// the exact failure the skeleton prompt calls worse than an empty slot.
const CATEGORY_NAME_PATTERNS = [
  /^(a|an|the)\s+(local|lakeside|seaside|nearby|traditional|family[- ]run|cozy|charming)?\s*\w*\s*(restaurant|ristorante|trattoria|osteria|café|cafe|bistro|eatery|taverna|bakery|food stalls?)/i,
  /\b(in|near|at)\s+the\s+(village|town|harbou?r|old town)\b/i,
  /^(local|lakeside|seaside|waterfront|neighborhood)\s+(restaurant|café|cafe|dining|eatery|spot)/i,
  /^(breakfast|lunch|dinner)\s+(at|in|near)\b/i,
  /^(hotel|guesthouse)\s+(breakfast|restaurant)$/i,
];

const wordCount = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

function lodgingNameSet(itinerary) {
  const names = new Set();
  for (const loc of itinerary?.accommodation ?? []) {
    for (const opt of loc?.options ?? []) {
      if (opt?.name) names.add(String(opt.name).trim().toLowerCase());
    }
  }
  return names;
}

// Also treat any dining entry that self-identifies as the stay's own dining
// room as lodging ("Rifugio X (half board)", "hotel breakfast at ...").
function looksLikeLodgingMeal(name, lodging) {
  const key = String(name).trim().toLowerCase();
  if (lodging.has(key)) return true;
  for (const l of lodging) {
    if (l && (key.includes(l) || l.includes(key))) return true;
  }
  return /\b(rifugio|refuge|hut|lodge|ryokan|half board|half-board|hotel (breakfast|dinner|dining))\b/i.test(name);
}

export function runChecks(fixture) {
  const findings = [];
  const stats = {};
  const add = (check, level, detail) => findings.push({ check, level, detail });

  const it = fixture.itinerary;
  if (!it || typeof it !== "object") {
    add("parse", "fail", `itinerary missing or unparseable (${fixture.meta?.parseNote})`);
    return { findings, stats };
  }
  if (fixture.meta?.parseNote && fixture.meta.parseNote !== "clean") {
    add("parse", "warn", `itinerary needed repair: ${fixture.meta.parseNote}`);
  }
  if (fixture.meta && fixture.meta.streamComplete === false) {
    add("stream", "fail", "stream ended without [DONE] — output may be truncated");
  }

  const days = Array.isArray(it.days) ? it.days : [];
  stats.dayCount = days.length;
  if (days.length === 0) add("days", "fail", "no days[] in output");

  const requestedDays = fixture.request?.preferences?.durationDays;
  if (requestedDays && days.length && Math.abs(days.length - requestedDays) > 2) {
    add("duration", "warn", `requested ~${requestedDays} days, got ${days.length}`);
  }

  const failedDays = days.filter(d => d?.generationFailed).map(d => d.dayNumber);
  stats.failedDays = failedDays;
  if (failedDays.length) add("failed-days", "fail", `day(s) ${failedDays.join(", ")} have no content`);

  // Summary-level required richness fields.
  for (const [path, v] of [
    ["summary.vibeSummary", it.summary?.vibeSummary],
    ["summary.bestTimeNote", it.summary?.bestTimeNote],
  ]) {
    if (!v || !String(v).trim()) add("summary", "warn", `${path} missing`);
  }

  // noFlight contract.
  if (fixture.request?.preferences?.noFlight) {
    if (it.flights && it.flights.skip !== true) add("flights", "fail", "noFlight requested but flights.skip !== true");
    if ((it.flights?.options ?? []).length > 0) add("flights", "fail", "noFlight requested but flight options present");
  } else if (it.flights && !it.flights.skip) {
    if (!it.flights.context) add("flights", "warn", "flights.context missing");
    for (const opt of it.flights.options ?? []) {
      for (const f of ["airlineCode", "route", "airline", "stops", "duration"]) {
        if (!opt?.[f]) { add("flights", "warn", `flight option missing ${f}`); break; }
      }
    }
  }

  const lodging = lodgingNameSet(it);
  const diningUse = new Map(); // name -> count (non-lodging)
  let periodsTotal = 0, emptyDiningPeriods = 0, activityCount = 0, diningCount = 0;
  let overlongDescriptions = 0, genericHits = [], categoryNames = [], badUrls = [];
  let primaryViolations = 0;

  for (const day of days) {
    if (day?.generationFailed) continue;
    const periods = Array.isArray(day?.periods) ? day.periods : [];
    const labels = periods.map(p => p?.label);
    if (labels.length !== 3 || !PERIOD_LABELS.every((l, i) => labels[i] === l)) {
      add("periods", "fail", `day ${day?.dayNumber}: periods are [${labels.join(", ")}], expected Morning/Afternoon/Evening`);
    }

    for (const period of periods) {
      periodsTotal++;
      const acts = Array.isArray(period?.activities) ? period.activities : [];
      if (acts.length < 1 || acts.length > 3) {
        add("activities", "fail", `day ${day?.dayNumber} ${period?.label}: ${acts.length} activities (expected 1-3)`);
      }
      for (const a of acts) {
        activityCount++;
        if (wordCount(a?.name) > 8) add("activity-name", "warn", `day ${day?.dayNumber}: long activity name "${a?.name}"`);
        const wc = wordCount(a?.description);
        if (wc > 30) { overlongDescriptions++; }
        const desc = String(a?.description ?? "").toLowerCase();
        for (const g of GENERIC_PHRASES) {
          if (desc.includes(g)) genericHits.push(`day ${day?.dayNumber}: "${g}" in "${a?.name}"`);
        }
        for (const tag of a?.tags ?? []) {
          if (!ALLOWED_TAGS.has(tag)) add("tags", "fail", `day ${day?.dayNumber}: unknown tag "${tag}"`);
        }
      }

      const dining = Array.isArray(period?.dining) ? period.dining : [];
      if (dining.length === 0) emptyDiningPeriods++;
      if (dining.length > 2) add("dining", "fail", `day ${day?.dayNumber} ${period?.label}: ${dining.length} dining options (max 2)`);
      if (dining.length > 0 && dining[0]?.isPrimary !== true) primaryViolations++;
      for (const d of dining) {
        diningCount++;
        const name = String(d?.name ?? "").trim();
        if (!name) { add("dining", "fail", `day ${day?.dayNumber} ${period?.label}: dining entry with no name`); continue; }
        if (CATEGORY_NAME_PATTERNS.some(rx => rx.test(name)) && !looksLikeLodgingMeal(name, lodging)) {
          categoryNames.push(`day ${day?.dayNumber} ${period?.label}: "${name}"`);
        }
        if (!looksLikeLodgingMeal(name, lodging)) {
          const key = name.toLowerCase();
          diningUse.set(key, (diningUse.get(key) ?? 0) + 1);
        }
        const desc = String(d?.description ?? "").toLowerCase();
        for (const g of GENERIC_PHRASES) {
          if (desc.includes(g)) genericHits.push(`day ${day?.dayNumber} dining: "${g}" in "${name}"`);
        }
        const url = String(d?.url ?? "");
        if (url && !/^https?:\/\//i.test(url)) badUrls.push(url);
      }
    }
  }

  // URL hygiene across the whole document.
  const urlFields = JSON.stringify(it).match(/"url":"(.*?)"/g) ?? [];
  for (const m of urlFields) {
    const url = m.slice(7, -1);
    if (!/^https?:\/\//i.test(url) || /example\.com|\.\.\.|PLACE\+NAME|HOTEL\+NAME|TOUR\+DESCRIPTION|ORIGIN|DESTINATION\b/.test(url)) {
      badUrls.push(url);
    }
  }

  const repeated = [...diningUse.entries()].filter(([, n]) => n > 2);
  stats.periodsTotal = periodsTotal;
  stats.activityCount = activityCount;
  stats.diningCount = diningCount;
  stats.emptyDiningPeriods = emptyDiningPeriods;
  stats.uniqueRestaurants = diningUse.size;
  stats.repeatedRestaurants = repeated.map(([n, c]) => `${n} x${c}`);
  stats.overlongDescriptions = overlongDescriptions;
  stats.genericPhraseHits = genericHits.length;
  stats.categoryDiningNames = categoryNames.length;

  if (primaryViolations) add("dining", "fail", `${primaryViolations} period(s) whose first dining option is not isPrimary:true`);
  for (const [name, n] of repeated) add("dining-repetition", "fail", `"${name}" used ${n}x (cap is 2, lodging exempt)`);
  for (const c of categoryNames) add("category-dining", "fail", `category description instead of establishment name — ${c}`);
  if (overlongDescriptions) add("descriptions", "warn", `${overlongDescriptions} description(s) over 30 words (rule: ~25)`);
  for (const g of genericHits.slice(0, 10)) add("generic-language", "warn", g);
  for (const u of [...new Set(badUrls)].slice(0, 10)) add("urls", "fail", `malformed or template URL: ${u}`);

  // Booking checklist should exist and carry lead times.
  const checklist = Array.isArray(it.bookingChecklist) ? it.bookingChecklist : [];
  stats.bookingChecklistItems = checklist.length;
  if (checklist.length === 0) add("booking-checklist", "warn", "bookingChecklist is empty");
  for (const item of checklist) {
    if (!item?.leadTime) add("booking-checklist", "warn", `checklist item "${item?.item}" missing leadTime`);
    if (item?.priority && !["high", "medium", "low"].includes(item.priority)) {
      add("booking-checklist", "fail", `invalid priority "${item.priority}"`);
    }
  }

  return { findings, stats };
}

export function summarizeChecks(result) {
  const fails = result.findings.filter(f => f.level === "fail").length;
  const warns = result.findings.filter(f => f.level === "warn").length;
  return { fails, warns };
}
