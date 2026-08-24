import type { ItineraryData } from "@/types/itinerary";

// Helpers for the whole-itinerary edit flow: what gets sent to the
// edit-itinerary function, and how its response is validated before it is
// allowed to replace the trip on screen. Kept out of Index.tsx so the flow is
// unit-testable.

export const stripPlanningSection = (content: string): string => {
  const closingTag = "</itinerary_planning>";
  const closingIndex = content.indexOf(closingTag);
  if (closingIndex !== -1) return content.slice(closingIndex + closingTag.length).trimStart();
  if (content.includes("<itinerary_planning>")) return "";
  return content;
};

// Parse a completed itinerary's JSON, repairing truncated output if needed.
export const parseStructuredItinerary = (content: string): ItineraryData | undefined => {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return undefined;
    const raw = jsonMatch[0];
    try {
      return JSON.parse(raw) as ItineraryData;
    } catch {
      // Repair truncated JSON using a proper bracket stack
      const repairJson = (s: string): string => {
        let t = s.trimEnd().replace(/,\s*$/, "");
        const stack: string[] = [];
        let inStr = false;
        let esc = false;
        for (const ch of t) {
          if (esc) { esc = false; continue; }
          if (ch === "\\" && inStr) { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === "{") stack.push("}");
          else if (ch === "[") stack.push("]");
          else if (ch === "}" || ch === "]") stack.pop();
        }
        if (inStr) t += '"';
        while (stack.length > 0) t += stack.pop()!;
        return t;
      };
      return JSON.parse(repairJson(raw)) as ItineraryData;
    }
  } catch (e) {
    console.error("Failed to parse structured itinerary:", e);
    return undefined;
  }
};

// What goes to the edit model. Sources and access are held back: the model has
// no business rewriting citations or entitlement state, and both are
// re-attached to whatever comes back. Legacy markdown trips (saved before the
// JSON migration) send their raw content unchanged.
export const buildEditableItinerary = (variant: {
  content: string;
  structuredData?: ItineraryData;
}): string => {
  if (!variant.structuredData) return variant.content;
  const { sources: _sources, access: _access, ...editable } = variant.structuredData;
  return JSON.stringify(editable);
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isOptionalArray = (v: unknown): boolean => v == null || Array.isArray(v);

// StructuredItinerary maps over these collections without guards, and the app
// has no error boundary — committing data that fails this check would crash
// the whole page instead of showing a trip.
export const isRenderableItinerary = (data: unknown): data is ItineraryData => {
  if (!isObj(data)) return false;
  if (!isObj(data.summary) || !Array.isArray(data.summary.highlights)) return false;
  if (!isOptionalArray(data.summary.assumptions)) return false;
  if (!isObj(data.budget) || !Array.isArray(data.budget.items)) return false;
  if (!isObj(data.flights) || !Array.isArray(data.flights.options)) return false;
  if (!Array.isArray(data.accommodation)) return false;
  if (!data.accommodation.every(loc => isObj(loc) && Array.isArray(loc.options))) return false;
  if (!Array.isArray(data.bookingChecklist)) return false;
  if (!Array.isArray(data.days) || data.days.length === 0) return false;
  for (const day of data.days) {
    if (!isObj(day) || !Array.isArray(day.periods)) return false;
    for (const period of day.periods) {
      if (!isObj(period) || !Array.isArray(period.activities)) return false;
      if (!isOptionalArray(period.dining)) return false;
    }
  }
  if (!isOptionalArray(data.alternatives)) return false;
  if (!isOptionalArray(data.sources)) return false;
  return true;
};

// Validate an edit response and graft back the fields the model never saw.
// Returns null when the response is not safe to render, so the caller can keep
// the current trip and surface a failure instead of degrading the UI.
export const mergeEditedItinerary = (
  displayContent: string,
  previous: ItineraryData,
): ItineraryData | null => {
  const parsed = parseStructuredItinerary(displayContent);
  if (!isRenderableItinerary(parsed)) return null;
  return { ...parsed, sources: previous.sources, access: previous.access };
};
