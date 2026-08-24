/* eslint-disable @typescript-eslint/no-explicit-any -- the rejection table
   deliberately mangles the fixture into shapes the type system forbids */
import { describe, it, expect } from "vitest";
import {
  parseStructuredItinerary,
  stripPlanningSection,
  buildEditableItinerary,
  isRenderableItinerary,
  mergeEditedItinerary,
} from "./itineraryEdit";
import { makeItinerary } from "@/test/fixtures/itinerary";

describe("stripPlanningSection", () => {
  it("passes content without planning tags through unchanged", () => {
    expect(stripPlanningSection("plain content")).toBe("plain content");
  });

  it("removes a closed planning block and leading whitespace", () => {
    const input = "<itinerary_planning>thinking...</itinerary_planning>\n\n{\"a\":1}";
    expect(stripPlanningSection(input)).toBe('{"a":1}');
  });

  it("returns empty for an unclosed planning block", () => {
    expect(stripPlanningSection("<itinerary_planning>still thinking")).toBe("");
  });
});

describe("parseStructuredItinerary", () => {
  it("parses a bare JSON itinerary", () => {
    const data = makeItinerary();
    expect(parseStructuredItinerary(JSON.stringify(data))).toEqual(data);
  });

  it("extracts JSON wrapped in prose and code fences", () => {
    const data = makeItinerary();
    const wrapped = "Here is the updated itinerary:\n```json\n" + JSON.stringify(data) + "\n```\nEnjoy!";
    expect(parseStructuredItinerary(wrapped)).toEqual(data);
  });

  it("repairs truncated JSON", () => {
    const full = JSON.stringify(makeItinerary());
    const truncated = full.slice(0, full.length - 40);
    const repaired = parseStructuredItinerary(truncated);
    expect(repaired).toBeDefined();
    expect(repaired!.summary.destination).toBe("Moab, Utah");
  });

  it("returns undefined for content with no JSON object", () => {
    expect(parseStructuredItinerary("## Day 1: Moab\n- Morning hike")).toBeUndefined();
  });
});

describe("buildEditableItinerary", () => {
  it("sends structured trips as JSON without sources and access", () => {
    const structuredData = makeItinerary();
    structuredData.access = {
      tier: "preview_primary",
      lockedDayCount: 2,
      lockedBookingCounts: { high: 1, medium: 0, low: 0 },
    };
    const outbound = buildEditableItinerary({ content: "ignored raw", structuredData });
    const parsed = JSON.parse(outbound);
    expect(parsed.sources).toBeUndefined();
    expect(parsed.access).toBeUndefined();
    expect(parsed.summary.destination).toBe("Moab, Utah");
    expect(parsed.days).toHaveLength(2);
    // bookingUrl and the day's explanation must survive the round trip to the model
    expect(parsed.days[0].periods[1].activities[0].bookingUrl).toContain("recreation.gov");
    expect(parsed.days[0].overview).toContain("soft landing");
  });

  it("sends legacy markdown trips as their raw content", () => {
    const content = "## Day 1: Moab\n- Morning hike";
    expect(buildEditableItinerary({ content })).toBe(content);
  });
});

describe("isRenderableItinerary", () => {
  it("accepts a complete itinerary", () => {
    expect(isRenderableItinerary(makeItinerary())).toBe(true);
  });

  it("accepts locked and generation-failed days with empty periods", () => {
    const data = makeItinerary();
    data.days.push({ dayNumber: 3, title: "Locked day", location: "Moab", periods: [], locked: true });
    data.days.push({ dayNumber: 4, title: "Failed day", location: "Moab", periods: [], generationFailed: true });
    expect(isRenderableItinerary(data)).toBe(true);
  });

  it.each([
    ["missing summary", (d: any) => delete d.summary],
    ["highlights not an array", (d: any) => { d.summary.highlights = "great trip"; }],
    ["missing budget", (d: any) => delete d.budget],
    ["budget.items not an array", (d: any) => { d.budget.items = {}; }],
    ["missing flights", (d: any) => delete d.flights],
    ["flights.options not an array", (d: any) => delete d.flights.options],
    ["accommodation not an array", (d: any) => { d.accommodation = { location: "Moab" }; }],
    ["accommodation entry without options", (d: any) => delete d.accommodation[0].options],
    ["missing bookingChecklist", (d: any) => delete d.bookingChecklist],
    ["empty days", (d: any) => { d.days = []; }],
    ["day without periods", (d: any) => delete d.days[0].periods],
    ["period without activities", (d: any) => delete d.days[0].periods[0].activities],
    ["dining wrong type", (d: any) => { d.days[0].periods[0].dining = "Moab Diner"; }],
    ["assumptions wrong type", (d: any) => { d.summary.assumptions = "solo"; }],
    ["alternatives wrong type", (d: any) => { d.alternatives = {}; }],
  ])("rejects an itinerary with %s", (_label, mutate) => {
    const data = makeItinerary() as any;
    mutate(data);
    expect(isRenderableItinerary(data)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isRenderableItinerary(undefined)).toBe(false);
    expect(isRenderableItinerary("markdown")).toBe(false);
    expect(isRenderableItinerary(null)).toBe(false);
  });
});

describe("mergeEditedItinerary", () => {
  it("re-attaches sources and access the model never saw", () => {
    const previous = makeItinerary();
    const response = makeItinerary();
    delete response.sources;
    response.summary.destination = "Bend, Oregon";
    const merged = mergeEditedItinerary(JSON.stringify(response), previous);
    expect(merged).not.toBeNull();
    expect(merged!.summary.destination).toBe("Bend, Oregon");
    expect(merged!.sources).toEqual(previous.sources);
  });

  it("returns null for a markdown response (the reported regression)", () => {
    const previous = makeItinerary();
    const markdown = "## EXECUTIVE SUMMARY\n- **Destination:** Moab, Utah\n\n## Day 1: Moab\n- Morning hike";
    expect(mergeEditedItinerary(markdown, previous)).toBeNull();
  });

  it("returns null when truncation repair yields a structurally broken trip", () => {
    const previous = makeItinerary();
    const full = JSON.stringify(makeItinerary());
    // Cut inside the first day, before its periods — bracket repair will close
    // the JSON but the day has no periods array, which must not be committed.
    const cut = full.slice(0, full.indexOf('"periods"'));
    expect(mergeEditedItinerary(cut, previous)).toBeNull();
  });

  it("survives a planning block plus fenced JSON around a valid response", () => {
    const previous = makeItinerary();
    const response = makeItinerary();
    const body = "```json\n" + JSON.stringify(response) + "\n```";
    const merged = mergeEditedItinerary(body, previous);
    expect(merged).not.toBeNull();
    expect(merged!.days).toHaveLength(2);
  });
});
