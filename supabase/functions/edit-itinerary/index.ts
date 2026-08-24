import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TripPreferencesSchema = z.object({
  media: z.array(z.object({
    type: z.enum(['image', 'video']),
    preview: z.string().max(10000).optional(),
    url: z.string().max(1000).optional(),
    name: z.string().max(200).optional(),
  })).max(10).optional(),
  cities: z.array(z.string().max(100)).max(20).optional(),
  budgetAccommodation: z.number().min(0).max(100).optional(),
  budgetFlight: z.number().min(0).max(100).optional(),
  dateFlexibility: z.string().max(50).optional(),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  targetMonth: z.string().max(50).optional(),
  durationFlexibility: z.string().max(50).optional(),
  durationDays: z.number().min(1).max(90).optional(),
  noFlight: z.boolean().optional(),
  departureCity: z.string().max(100).optional(),
  flightDirectness: z.string().max(50).optional(),
  atmosphere: z.array(z.string().max(50)).max(10).optional(),
  adventureLevel: z.string().max(50).optional(),
  guidedPreference: z.string().max(50).optional(),
  foodDrink: z.array(z.string().max(50)).max(10).optional(),
  interests: z.array(z.string().max(50)).max(20).optional(),
  additionalNotes: z.string().max(5000).optional(),
});

const RequestSchema = z.object({
  editRequest: z.string().min(1).max(2000),
  currentItinerary: z.string().min(1).max(200000),
  themeTitle: z.string().max(200),
  tripPreferences: TripPreferencesSchema,
});

// Helper functions for context building
const getBudgetLabel = (value?: number) => {
  if (!value || value <= 25) return { label: "Budget", accommodation: "$0-$50/night", daily: "$50-80/day" };
  if (value <= 50) return { label: "Moderate", accommodation: "$50-$100/night", daily: "$100-150/day" };
  if (value <= 75) return { label: "Comfortable", accommodation: "$100-$200/night", daily: "$200-300/day" };
  return { label: "Luxury", accommodation: "$200+/night", daily: "$400+/day" };
};

const getFlightBudget = (value?: number) => {
  if (!value || value <= 25) return "$100-$300";
  if (value <= 50) return "$300-$600";
  if (value <= 75) return "$600-$1000";
  return "$1000+";
};

const guidedLabels: Record<string, string> = {
  'fully-guided': 'Prefer guided tours and organized activities',
  'some-guided': 'Mix of guided activities and self-exploration',
  'self-guided': 'Self-guided only - no guided tours, DIY everything'
};

const adventureLabels: Record<string, string> = {
  'none': 'Relaxed',
  'family': 'Family-friendly',
  'active': 'Active',
  'adrenaline': 'Adrenaline junky'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const validationResult = RequestSchema.safeParse(body);
    
    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.errors);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input', 
          details: validationResult.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { editRequest, currentItinerary, themeTitle, tripPreferences } = validationResult.data;
    console.log('Edit request:', editRequest);
    console.log('Theme:', themeTitle);

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    // Build full user context
    const budgetInfo = getBudgetLabel(tripPreferences.budgetAccommodation);
    const flightBudget = getFlightBudget(tripPreferences.budgetFlight);
    const guidedLabel = guidedLabels[tripPreferences.guidedPreference || ''] || 'No preference';

    // Build date context
    let dateContext = "";
    switch (tripPreferences.dateFlexibility) {
      case "strict":
        dateContext = tripPreferences.startDate && tripPreferences.endDate 
          ? `Fixed dates: ${tripPreferences.startDate} to ${tripPreferences.endDate}` 
          : "Specific dates";
        break;
      case "flexible-days":
        dateContext = tripPreferences.startDate 
          ? `Around ${tripPreferences.startDate} (±few days flexible)` 
          : "Flexible around specific dates";
        break;
      case "month":
        dateContext = tripPreferences.targetMonth 
          ? `Target: ${tripPreferences.targetMonth}` 
          : "Specific month/season";
        break;
      default:
        dateContext = "Anytime";
    }

    // Build duration context
    let durationContext = `${tripPreferences.durationDays || 7} days`;
    if (tripPreferences.durationFlexibility === "flexible-days") {
      durationContext = `approximately ${tripPreferences.durationDays || 7} days (±2 days flexible)`;
    }

    // Build flight context
    let flightContext = "";
    if (tripPreferences.noFlight) {
      flightContext = "- **NO FLIGHT NEEDED**: This is a local/road trip or the traveler is arranging their own transportation.";
    } else {
      flightContext = `- Budget (Flights): ${flightBudget} round trip
- Flight preference: ${tripPreferences.flightDirectness || 'No preference'}
${tripPreferences.departureCity ? `- Departing from: ${tripPreferences.departureCity}` : ""}`;
    }

    const userInputsBlock = `
**INSPIRATION (destinations)**: ${tripPreferences.cities?.join(', ') || 'Not specified'}

**LOGISTICS**:
- Budget (Accommodation): ${budgetInfo.label} (${budgetInfo.accommodation}, ~${budgetInfo.daily} total daily)
${flightContext}
- Date flexibility: ${dateContext}
- Duration: ${durationContext}

**VIBE**:
- Atmosphere: ${tripPreferences.atmosphere?.join(', ') || 'No preference'}
- Adventure level: ${adventureLabels[tripPreferences.adventureLevel || ''] || tripPreferences.adventureLevel || 'No preference'}
- Guided vs self-serve: ${guidedLabel}
- Food & drink: ${tripPreferences.foodDrink?.join(', ') || 'No preference'}
- Interests (ranked): ${tripPreferences.interests?.join(' > ') || 'No preference'}

**ADDITIONAL NOTES**:
${tripPreferences.additionalNotes || 'None provided'}
`;

    // Current itineraries are structured JSON (the ItineraryData schema the app
    // renders); itineraries saved before that migration are markdown. The output
    // must come back in the same format it arrived in, or the app falls back to
    // the legacy markdown renderer and the redesigned layout is lost.
    const isStructured = currentItinerary.trimStart().startsWith('{');

    // Mirrors ItineraryData in src/types/itinerary.ts and the generate-itinerary
    // output schema — a field added there must be added here too, or edits will
    // strip it. The "preserve unknown fields" rule below is the safety net for
    // anything this prose copy is missing.
    const structuredFormatRules = `## Output Format (CRITICAL - JSON ONLY)

The itinerary you receive is a single JSON object. Your output MUST be the complete updated itinerary as a single valid JSON object in EXACTLY the same schema — same field names, same nesting, same value formats. No markdown, no prose, no code fences: after your </edit_planning> section, output raw JSON starting with { and ending with }.

The schema, for reference (every field you receive must survive the edit unless the edit changes it):
- "summary": { destination, duration, recommendedDates, totalBudget, highlights[], assumptions[]?, bestTimeNote?, vibeSummary? }
- "budget": { items: [{ category, range, description? }], total }
- "flights": { skip?, context?, options: [{ description, price, url, airlineCode?, route?, viaCity?, airline?, stops?, duration?, departureTime?, badge? }] }
- "accommodation": [{ location, nights, options: [{ name, type?, pricePerNight, why?, url, isPrimary }] }]
- "bookingChecklist": [{ item, leadTime, estimatedCost, url, priority: "high"|"medium"|"low" }]
- "days": [{ dayNumber, title, location, transitNote?, overview?, locked?, generationFailed?, periods: [{ label: "Morning"|"Afternoon"|"Evening", activities: [{ name, description, duration?, cost?, tags?[], bookingUrl? }], dining?: [{ name, description, priceRange?, url?, isPrimary? }] }] }]
- "overview" is the 1–2 sentence explanation of how the day fits together, shown to the traveler above the day's plan. If your edit changes a day's shape, rewrite its overview to match; if a day you touch has none, add one.
- "alternatives"?: [{ title, description, url? }]

Rules for the JSON output:
- Every day that has content keeps exactly 3 periods: Morning, Afternoon, Evening
- A day carrying "locked": true or "generationFailed": true intentionally has no periods (or empty periods) — copy such days through EXACTLY as received, flags included. NEVER invent content for them.
- All string values are plain text — no markdown asterisks, no HTML
- New places need real URLs: Google Maps search links for restaurants and attractions (https://www.google.com/maps/search/?api=1&query=NAME+CITY), booking.com search links for hotels, getyourguide.com search links for tours
- Never invent a restaurant or hotel to fill a slot — only add places you are confident exist
- If the edit changes costs, keep "budget" and "summary.totalBudget" consistent with the new plan
- Preserve every field of every unaffected item byte-for-byte — do not rewrite, reorder, or reformat content the edit does not touch
- Do not invent new field names. If the input contains a field this schema does not list, preserve it unchanged — never drop it.`;

    const markdownFormatRules = `## Formatting Rules (CRITICAL - FOLLOW EXACTLY)

### Header Hierarchy:
- **## SECTION TITLE** - Main sections (EXECUTIVE SUMMARY, KEY BOOKINGS, etc.) - ALL CAPS
- **## Day X: Location - Theme** - Day headers
- **### Sub-section Title** - Sub-sections (Flights, Accommodation, Budget Breakdown)
- **#### Time Period** - Time-of-day headers (Morning, Afternoon, Evening)

### Bullet Point Rules (MANDATORY):
- ALL content under headers MUST be bullet points using "-" (hyphen)
- Top-level bullets: "- Content here" (no leading spaces)
- Nested bullets level 1: "  - Content here" (exactly 2 spaces before hyphen)
- Nested bullets level 2: "    - Content here" (exactly 4 spaces before hyphen)
- NEVER use "*" for bullets - ONLY use "-"
- NEVER write loose paragraph text - ALWAYS use bullets

### URL Formatting:
EVERY place, restaurant, tour, or hotel MUST have a clickable URL using these patterns:

**For restaurants/cafes/bars** - Use specific names:
- https://www.google.com/maps/search/?api=1&query=RESTAURANT+NAME+CITY

**For places/attractions**:
- https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY

**For tours**:
- https://www.getyourguide.com/s/?q=TOUR+DESCRIPTION+CITY

**For hotels**:
- https://www.booking.com/searchresults.html?ss=HOTEL+NAME+CITY

### Emoji Usage:
- ✈️ for flights, 🏨 for accommodation, 🍽️ for dining, 🚌 for transport, 💰 for budget
- Activity emojis (🏯🎨🌳) at start of activity names only

### Bold Text:
- **Bold** important names, prices, time slots
- Do NOT bold entire sentences`;

    const systemPrompt = `You are an expert travel itinerary editor. You will receive an existing itinerary and an edit request from the user.

## Your Task

Apply the user's edit request to the existing itinerary while:
1. Following the edit instructions PRECISELY
2. Preserving all unaffected content EXACTLY as-is
3. Maintaining the original structure and formatting
4. Ensuring the edit fits naturally with the rest of the itinerary

## Understanding the User Context

The user has already generated an itinerary based on these preferences. Use this context to ensure your edits are consistent with their overall trip vision:

${userInputsBlock}

## CRITICAL: Following the Edit Request

**READ THE EDIT REQUEST CAREFULLY.** The user's edit request is the PRIMARY instruction you must follow.

Before making changes, reason through:
1. What EXACTLY is the user asking to change?
2. Which specific sections/days/items are affected?
3. What should remain UNCHANGED?
4. Does this edit conflict with any stated preferences? If so, the edit request takes priority.

**PAY SPECIAL ATTENTION TO:**
- The user's Additional Notes above - these often contain critical constraints or preferences
- The edit request may add detail, override previous choices, or request entirely new content
- If the edit request contradicts something in the original preferences, FOLLOW THE EDIT REQUEST

## Planning Your Edit (IMPORTANT)

Before writing your output, work through your thinking in <edit_planning> tags:

1. **Quote the edit request** - Write out exactly what the user asked for
2. **Identify affected sections** - List which parts of the itinerary need to change
3. **Plan the changes** - Describe specifically what you will add/modify/remove
4. **Check for consistency** - Ensure the changes fit with the rest of the itinerary
5. **Verify formatting** - Note any formatting requirements for the changed sections

After </edit_planning>, output the COMPLETE updated itinerary.

${isStructured ? structuredFormatRules : markdownFormatRules}

## Important Guidelines

- Make ONLY the changes requested - preserve everything else EXACTLY
- If the edit affects one day, other days should remain unchanged
- Maintain consistent budget if the user didn't ask to change it
- Keep the same level of detail and style as the original
- If adding new activities/restaurants, provide the same detail level as existing ones
- Ensure transportation and timing still make sense after the edit

## Output

After your </edit_planning> section, output the COMPLETE updated itinerary with all sections, even those that weren't changed. The user needs the full itinerary back, not just the edited portions.${isStructured ? ' Output it as raw JSON — the app parses it directly, so anything that is not the JSON object breaks the itinerary.' : ''}`;

    const userPrompt = `## Theme: ${themeTitle}

## Current Itinerary:

${currentItinerary}

---

## EDIT REQUEST:

${editRequest}

---

Apply the edit request above to the itinerary. First plan your changes in <edit_planning> tags, then output the complete updated itinerary.`;

    console.log('Calling Anthropic for itinerary edit...');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 32000,
        temperature: 0.7,
        // A full-itinerary rewrite can run for minutes; a non-streaming request
        // that long risks the HTTP timeout. The stream is accumulated below —
        // the client still receives a single JSON response.
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Usage limit reached. Please add credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    let updatedItinerary = '';
    let stopReason: string | null = null;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            updatedItinerary += event.delta.text ?? '';
          } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason;
          }
        } catch { /* pings and non-JSON lines */ }
      }
    }
    updatedItinerary = updatedItinerary.trim();

    if (!updatedItinerary) {
      throw new Error('No content returned from AI');
    }

    // A max_tokens stop means the JSON was cut off mid-document. Returning it
    // would let the client's truncation repair "successfully" parse a partial
    // trip and overwrite the full one — fail loudly instead.
    if (stopReason === 'max_tokens') {
      console.error('Edit output truncated at max_tokens, length:', updatedItinerary.length);
      return new Response(
        JSON.stringify({ error: 'This itinerary is too long to edit in one pass. Try a smaller, more specific change.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strip the <edit_planning> section from the output, plus any code fence the
    // model wrapped the JSON in despite instructions.
    updatedItinerary = updatedItinerary.replace(/<edit_planning>[\s\S]*?<\/edit_planning>/g, '').trim();
    updatedItinerary = updatedItinerary.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    console.log('Itinerary edit complete, length:', updatedItinerary.length);

    return new Response(
      JSON.stringify({ updatedItinerary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in edit-itinerary:', error);
    return new Response(
      JSON.stringify({ error: 'Unable to edit itinerary. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
