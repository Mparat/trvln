#!/usr/bin/env node
// Capture live itineraries from the deployed generate-itinerary edge function.
//
// Usage:
//   node eval/capture.mjs                     # all personas in personas.json
//   node eval/capture.mjs cdmx-food dolomites-hut
//
// Reads SUPABASE_URL / SUPABASE_ANON_KEY from the environment, falling back to
// the VITE_ values in .env. Writes eval/fixtures/<persona>.json (parsed
// itinerary + metadata) and <persona>.raw.txt (exact streamed text) so a parse
// failure is itself a captured result rather than a lost run.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
mkdirSync(fixturesDir, { recursive: true });

function envFromDotenv() {
  try {
    const text = readFileSync(join(here, "..", ".env"), "utf8");
    const out = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

const dotenv = envFromDotenv();
const SUPABASE_URL = process.env.SUPABASE_URL || dotenv.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || dotenv.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY (or VITE_ equivalents in .env)");
  process.exit(1);
}

// Same bracket-stack repair the client and the edge function use, so a stream
// cut off mid-document still yields something the checks can grade (and the
// truncation is recorded in meta rather than hidden).
function repairTruncatedJson(input) {
  let text = input.trimEnd().replace(/,\s*$/, "");
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inString) text += '"';
  text = text.replace(/,\s*$/, "");
  while (stack.length) text += stack.pop();
  return text;
}

async function capture(persona) {
  const t0 = Date.now();
  console.log(`[${persona.id}] requesting…`);
  const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-itinerary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({
      preferences: persona.preferences,
      ...(persona.themeVariant ? { themeVariant: persona.themeVariant } : {}),
      jobId: randomUUID(),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${body.slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let complete = false;

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") { complete = true; break outer; }
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) full += content;
      } catch { /* skip malformed lines */ }
    }
  }
  reader.cancel().catch(() => {});

  const elapsedMs = Date.now() - t0;
  writeFileSync(join(fixturesDir, `${persona.id}.raw.txt`), full);

  let itinerary = null;
  let parseNote = "clean";
  try {
    itinerary = JSON.parse(full);
  } catch {
    try {
      itinerary = JSON.parse(repairTruncatedJson(full));
      parseNote = "repaired";
    } catch (err) {
      parseNote = `unparseable: ${err}`;
    }
  }

  const fixture = {
    meta: {
      personaId: persona.id,
      label: persona.label,
      capturedAt: new Date().toISOString(),
      elapsedMs,
      streamComplete: complete,
      parseNote,
      chars: full.length,
    },
    request: {
      preferences: persona.preferences,
      themeVariant: persona.themeVariant ?? null,
    },
    expectations: persona.expectations ?? "",
    itinerary,
  };
  writeFileSync(join(fixturesDir, `${persona.id}.json`), JSON.stringify(fixture, null, 2));
  console.log(
    `[${persona.id}] done in ${(elapsedMs / 1000).toFixed(1)}s — ` +
    `${full.length} chars, complete=${complete}, parse=${parseNote}`,
  );
  return fixture;
}

const bank = JSON.parse(readFileSync(join(here, "personas.json"), "utf8")).personas;
const wanted = process.argv.slice(2);
const personas = wanted.length ? bank.filter(p => wanted.includes(p.id)) : bank;
if (wanted.length && personas.length !== wanted.length) {
  const known = new Set(bank.map(p => p.id));
  console.error(`Unknown persona(s): ${wanted.filter(id => !known.has(id)).join(", ")}`);
  process.exit(1);
}

// Sequential on purpose: each generation fans out ~7 Perplexity searches, and
// two concurrent captures collide on Perplexity's rate limit, which degrades
// the very research quality the eval is trying to measure.
let failures = 0;
for (const persona of personas) {
  try {
    await capture(persona);
  } catch (err) {
    failures++;
    console.error(`[${persona.id}] FAILED: ${err}`);
  }
}
process.exit(failures ? 1 : 0);
