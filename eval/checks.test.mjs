#!/usr/bin/env node
// Self-test for checks.mjs: one clean day and one fixture seeded with the
// exact failure modes the pipeline has produced in the past (category dining
// names, restaurant repetition, generic language, template URLs). Run with:
//   node eval/checks.test.mjs

import assert from "node:assert/strict";
import { runChecks } from "./checks.mjs";

const day = (n, overrides = {}) => ({
  dayNumber: n,
  title: `Day ${n}`,
  location: "Ponta Delgada",
  periods: ["Morning", "Afternoon", "Evening"].map(label => ({
    label,
    activities: [{
      name: "Mercado da Graça stalls",
      description: "Queijo da ilha and warm bolo lêvedo straight off the griddle before the tour buses arrive.",
      duration: "1 hour", cost: "Free", tags: ["food", "cultural"],
    }],
    dining: [{
      name: `Restaurante ${label} ${n}`,
      description: "Order the alcatra — it has simmered overnight in this kitchen's clay pots.",
      priceRange: "$15–$25/person",
      url: "https://www.google.com/maps/search/?api=1&query=x",
      isPrimary: true,
    }],
  })),
  ...overrides,
});

const base = {
  meta: { parseNote: "clean", streamComplete: true },
  request: { preferences: { durationDays: 2, noFlight: false } },
  itinerary: {
    summary: { vibeSummary: "x", bestTimeNote: "y", assumptions: [] },
    budget: { items: [], total: "$1" },
    flights: { skip: false, context: "ctx", options: [{ airlineCode: "TP", route: "A→B", airline: "TAP", stops: "1 stop", duration: "4h" }] },
    accommodation: [{ location: "PDL", nights: 2, options: [{ name: "Grand Hotel Açores" }] }],
    bookingChecklist: [{ item: "Flights", leadTime: "3 months", priority: "high" }],
    days: [day(1), day(2)],
  },
};

// ── Clean fixture: no hard failures ─────────────────────────────────────────
{
  const { findings } = runChecks(structuredClone(base));
  const fails = findings.filter(f => f.level === "fail");
  assert.equal(fails.length, 0, `clean fixture should have 0 fails, got: ${JSON.stringify(fails)}`);
  console.log("✓ clean fixture passes");
}

// ── Seeded failures ─────────────────────────────────────────────────────────
{
  const bad = structuredClone(base);
  const d1 = bad.itinerary.days[0];
  // Category description instead of an establishment name.
  d1.periods[0].dining[0].name = "A lakeside trattoria in the village";
  // Same restaurant three times (cap is 2).
  d1.periods[1].dining[0].name = "Tony's Restaurant";
  d1.periods[2].dining[0].name = "Tony's Restaurant";
  bad.itinerary.days[1].periods[0].dining[0].name = "Tony's Restaurant";
  // Generic phrase + template URL.
  d1.periods[1].activities[0].description = "A hidden gem and iconic landmark that has something for everyone.";
  d1.periods[2].activities[0].tags = ["food", "not-a-real-tag"];
  bad.itinerary.bookingChecklist.push({ item: "Car", leadTime: "", priority: "urgent" });
  bad.itinerary.days[1].periods[2].dining[0].url = "https://www.booking.com/searchresults.html?ss=HOTEL+NAME+CITY";

  const { findings, stats } = runChecks(bad);
  const failsBy = check => findings.filter(f => f.level === "fail" && f.check === check);
  assert.ok(failsBy("category-dining").length >= 1, "category dining name should fail");
  assert.ok(failsBy("dining-repetition").length >= 1, "3x repetition should fail");
  assert.ok(failsBy("tags").length >= 1, "unknown tag should fail");
  assert.ok(failsBy("urls").length >= 1, "template URL should fail");
  assert.ok(failsBy("booking-checklist").length >= 1, "invalid priority should fail");
  assert.ok(findings.some(f => f.check === "generic-language"), "generic phrases should warn");
  assert.ok(stats.categoryDiningNames >= 1);
  console.log("✓ seeded failures all detected");
}

// ── Lodging exemption: the hut's dining room may repeat ─────────────────────
{
  const hut = structuredClone(base);
  hut.itinerary.accommodation = [{ location: "Alta Via", nights: 2, options: [{ name: "Rifugio Lagazuoi" }] }];
  for (const d of hut.itinerary.days) {
    d.periods[0].dining[0].name = "Rifugio Lagazuoi (half board breakfast)";
    d.periods[2].dining[0].name = "Rifugio Lagazuoi (half board dinner)";
  }
  const { findings } = runChecks(hut);
  assert.equal(findings.filter(f => f.check === "dining-repetition").length, 0, "lodging meals must not count as repetition");
  assert.equal(findings.filter(f => f.check === "category-dining").length, 0, "hut half-board is not a category name");
  console.log("✓ lodging half-board exemption honored");
}

// ── noFlight contract ───────────────────────────────────────────────────────
{
  const nf = structuredClone(base);
  nf.request.preferences.noFlight = true;
  const { findings } = runChecks(nf);
  assert.ok(findings.some(f => f.check === "flights" && f.level === "fail"), "noFlight with options should fail");
  console.log("✓ noFlight contract enforced");
}

console.log("all checks.test.mjs assertions passed");
