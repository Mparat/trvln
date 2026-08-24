#!/usr/bin/env node
// Runs a real generation against the DEPLOYED generate-itinerary edge function
// and writes the assembled itinerary JSON — the input scripts/eval-itinerary.mjs
// checks. Together they are the live quality loop:
//
//   node scripts/generate-live.mjs out.json
//   node scripts/eval-itinerary.mjs out.json [--judge]
//
// Connection comes from SUPABASE_URL / SUPABASE_ANON_KEY env vars, falling back
// to the repo's .env (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — the
// same public client-side values the app ships). The default test trip is
// shaped to exercise all four quality criteria: one city with distinct
// neighborhoods, a week long, ranked interests, and an open-text note the
// personalization has to bite into. Pass a JSON file of preferences as the
// second argument to test a different trip.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const outPath = process.argv[2] || "itinerary-live.json";
const prefsPath = process.argv[3];

function fromDotEnv() {
  const path = new URL("../.env", import.meta.url);
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8").split("\n").filter(l => l.includes("=")).map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
  );
}
const dotEnv = fromDotEnv();
const supabaseUrl = process.env.SUPABASE_URL || dotEnv.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || dotEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !anonKey) {
  console.error("Need SUPABASE_URL and SUPABASE_ANON_KEY (env or repo .env).");
  process.exit(2);
}

const preferences = prefsPath ? JSON.parse(readFileSync(prefsPath, "utf8")) : {
  media: [],
  cities: ["Vancouver, Canada"],
  budgetAccommodation: 60,
  budgetFlight: 50,
  dateFlexibility: "month",
  targetMonth: "September",
  durationFlexibility: "1-week",
  durationDays: 7,
  noFlight: false,
  departureCity: "New York",
  flightDirectness: "short-layover",
  atmosphere: ["outdoorsy", "local"],
  adventureLevel: "active",
  guidedPreference: "some-guided",
  foodDrink: ["local", "casual"],
  interests: ["nature", "food", "cycling", "neighborhoods"],
  additionalNotes:
    "First time in Vancouver. We love being outside — biking, hiking, water — but we also want to actually get to know the city's neighborhoods and eat where locals eat, not tourist rows. One bigger mountain day is great; we don't want to spend the whole week in transit.",
};

const url = `${supabaseUrl}/functions/v1/generate-itinerary`;
console.log(`POST ${url}`);
const t0 = Date.now();
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  },
  body: JSON.stringify({ preferences }),
});
if (!res.ok) {
  console.error("HTTP", res.status, await res.text());
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let content = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const jsonStr = line.slice(6).trim();
    if (jsonStr === "[DONE]") continue;
    try {
      const delta = JSON.parse(jsonStr).choices?.[0]?.delta?.content;
      if (delta) content += delta;
    } catch { /* SSE comment or malformed line */ }
  }
}
console.log(`stream done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${content.length} chars`);

let itinerary;
try {
  itinerary = JSON.parse(content);
} catch (e) {
  writeFileSync(`${outPath}.raw.txt`, content);
  console.error(`Unparseable stream (${e.message}) — raw saved to ${outPath}.raw.txt`);
  process.exit(1);
}
writeFileSync(outPath, JSON.stringify(itinerary, null, 2));
const withContent = (itinerary.days ?? []).filter(d => (d.periods ?? []).length > 0).length;
console.log(`parsed OK: ${itinerary.days?.length ?? 0} day(s), ${withContent} with content → ${outPath}`);
