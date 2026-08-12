import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildDateContext,
  buildDurationContext,
  buildSharedQuerySpecs,
  getBudgetLabel,
  getFlightBudget,
  resolveDestinations,
  runQuerySpecs,
} from "../_shared/research.ts";

// Runs the grounded research that every itinerary variant in a batch shares —
// destination resolution plus every search except the theme-specific
// activities query — and stores it for generate-itinerary to load by id.
//
// Called once per "generate" click. Previously each variant did this work
// itself, so the same searches ran once per theme and the variants could each
// resolve a different destination for what is meant to be one trip.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const PreferencesSchema = z.object({
  cities: z.array(z.string().max(100)).max(20).default([]),
  budgetAccommodation: z.number().min(0).max(100).default(50),
  budgetFlight: z.number().min(0).max(100).default(50),
  dateFlexibility: z.string().max(50).default('anytime'),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  flexibleDays: z.number().min(1).max(14).optional(),
  targetMonth: z.string().max(50).default(''),
  durationFlexibility: z.string().max(50).default('1-week'),
  durationDays: z.number().min(1).max(90).default(7),
  noFlight: z.boolean().default(false),
  departureCity: z.string().max(100).default(''),
  atmosphere: z.array(z.string().max(50)).max(10).default([]),
  adventureLevel: z.string().max(50).default('active'),
  foodDrink: z.array(z.string().max(50)).max(10).default([]),
  interests: z.array(z.string().max(50)).max(20).default([]),
  additionalNotes: z.string().max(5000).default(''),
}).passthrough();

const RequestSchema = z.object({
  preferences: PreferencesSchema,
  batchId: z.string().uuid().optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
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
            message: e.message,
          })),
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { preferences, batchId } = validationResult.data;

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    // Grounded research is not optional: the system prompt tells Claude that
    // everything it names comes from live search, so generating without it
    // produces a confidently-sourced itinerary built entirely on model priors.
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) {
      throw new Error("PERPLEXITY_API_KEY is not configured");
    }

    const budgetInfo = getBudgetLabel(preferences.budgetAccommodation);
    const flightBudget = getFlightBudget(preferences.budgetFlight);
    const durationContext = buildDurationContext(preferences);
    const dateContext = buildDateContext(preferences);

    const { cities: resolvedCities, wasResolved } = await resolveDestinations({
      cities: preferences.cities,
      additionalNotes: preferences.additionalNotes,
      atmosphere: preferences.atmosphere,
      interests: preferences.interests,
      adventureLevel: preferences.adventureLevel,
      foodDrink: preferences.foodDrink,
      budgetInfo,
      flightBudget,
      noFlight: preferences.noFlight,
      departureCity: preferences.departureCity,
      dateContext,
      durationContext,
    }, ANTHROPIC_API_KEY);

    const specs = buildSharedQuerySpecs({
      resolvedCities,
      interests: preferences.interests,
      foodDrink: preferences.foodDrink,
      additionalNotes: preferences.additionalNotes,
      budgetInfo,
      durationDays: preferences.durationDays,
      startDate: preferences.startDate,
      endDate: preferences.endDate,
      targetMonth: preferences.targetMonth,
      noFlight: preferences.noFlight,
      departureCity: preferences.departureCity,
    });

    const research = await runQuerySpecs(specs, PERPLEXITY_API_KEY);

    // Individual queries can come back empty, but if every one did then the
    // grounding failed and anything generated would be pure invention.
    if (Object.values(research).every(r => !r?.content)) {
      throw new Error("Grounded research returned no content for any query");
    }

    const researchId = crypto.randomUUID();
    const { error: insertError } = await supabaseAdmin.from("trip_research").insert({
      id: researchId,
      batch_id: batchId ?? null,
      destinations: resolvedCities,
      destination_was_resolved: wasResolved,
      research,
    });

    if (insertError) {
      console.error("Failed to store trip research:", insertError);
      throw new Error("Failed to store trip research");
    }

    console.log(`Stored shared research ${researchId} for destinations:`, resolvedCities);

    return new Response(
      JSON.stringify({ researchId, destinations: resolvedCities, destinationWasResolved: wasResolved }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in research-trip function:", error);
    return new Response(
      JSON.stringify({ error: "Unable to research this trip. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
