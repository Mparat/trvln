import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Vendor pricing snapshot (USD per million tokens) ────────────────────────
// Verified 2026-08-14 against vendor pricing pages. These are constants, not a
// live feed: when a vendor reprices, this table is what makes every cost row
// wrong, so it carries the date and the units to make an audit possible.
// Anthropic cache economics: writes bill at 1.25x input, reads at 0.1x.
type TokenPrice = {
  inPerM: number;
  outPerM: number;
  cacheWritePerM?: number;
  cacheReadPerM?: number;
};

const PRICE: Record<string, TokenPrice> = {
  "claude-sonnet-4-6": { inPerM: 3.0, outPerM: 15.0, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
  "claude-haiku-4-5": { inPerM: 1.0, outPerM: 5.0, cacheWritePerM: 1.25, cacheReadPerM: 0.10 },
  "sonar": { inPerM: 1.0, outPerM: 1.0 },
  "models/gemini-2.5-flash": { inPerM: 0.30, outPerM: 2.50 },
  "models/gemini-2.5-pro": { inPerM: 1.25, outPerM: 10.0 },
};

// Perplexity bills a per-request search fee on top of tokens: $5 per 1,000
// requests at the default "low" search context tier.
const PERPLEXITY_REQUEST_FEE_USD = 0.005;

// Google Places API (New) Text Search at the Pro field tier (display name,
// rating, review count, price level): $35 per 1,000 requests. No tokens —
// the whole cost is the per-request fee.
const PLACES_TEXT_SEARCH_FEE_USD = 0.035;

// Dated model ids ("claude-haiku-4-5-20251001") price as their base model.
function priceFor(model: string): TokenPrice | null {
  if (PRICE[model]) return PRICE[model];
  const base = Object.keys(PRICE).find(k => model.startsWith(k));
  return base ? PRICE[base] : null;
}

export type CostEntry = {
  phase: string;
  vendor: "anthropic" | "perplexity" | "google";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  requests: number;
  usd: number;
};

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export class CostTracker {
  entries: CostEntry[] = [];

  private push(entry: Omit<CostEntry, "usd">, extraUsd = 0) {
    const p = priceFor(entry.model);
    if (!p) {
      // An unknown model means the table is stale. Record the tokens with a
      // zero price rather than dropping the row — a visible gap beats a
      // silently low total.
      console.warn(`[cost] no price for model ${entry.model} — recording tokens at $0`);
      this.entries.push({ ...entry, usd: round6(extraUsd) });
      return;
    }
    const usd =
      (entry.inputTokens * p.inPerM +
        entry.outputTokens * p.outPerM +
        entry.cacheWriteTokens * (p.cacheWritePerM ?? p.inPerM) +
        entry.cacheReadTokens * (p.cacheReadPerM ?? p.inPerM)) / 1_000_000 +
      extraUsd;
    this.entries.push({ ...entry, usd: round6(usd) });
  }

  // Anthropic Messages API usage object, streaming or not.
  addAnthropic(phase: string, model: string, usage: Record<string, number> | undefined | null) {
    if (!usage) return;
    this.push({
      phase, vendor: "anthropic", model,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      requests: 1,
    });
  }

  // Perplexity chat completion. Newer responses carry usage.cost.total_cost in
  // dollars — when present it is the vendor's own number and wins over ours.
  addPerplexity(phase: string, model: string, usage: Record<string, unknown> | undefined | null) {
    const u = (usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; cost?: { total_cost?: number } };
    const vendorTotal = typeof u.cost?.total_cost === "number" ? u.cost.total_cost : null;
    if (vendorTotal !== null) {
      this.entries.push({
        phase, vendor: "perplexity", model,
        inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0,
        cacheWriteTokens: 0, cacheReadTokens: 0, requests: 1,
        usd: round6(vendorTotal),
      });
      return;
    }
    this.push({
      phase, vendor: "perplexity", model,
      inputTokens: u.prompt_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      cacheWriteTokens: 0, cacheReadTokens: 0, requests: 1,
    }, PERPLEXITY_REQUEST_FEE_USD);
  }

  // Google Places Text Search: flat per-request pricing, no usage object.
  addGooglePlaces(phase: string, requests: number) {
    if (!requests) return;
    this.entries.push({
      phase, vendor: "google", model: "places-text-search",
      inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0,
      requests,
      usd: round6(requests * PLACES_TEXT_SEARCH_FEE_USD),
    });
  }

  // Gemini generateContent usageMetadata. Thinking tokens bill as output.
  addGemini(phase: string, model: string, usage: Record<string, number> | undefined | null) {
    if (!usage) return;
    this.push({
      phase, vendor: "google", model,
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      cacheWriteTokens: 0, cacheReadTokens: 0, requests: 1,
    });
  }

  summary() {
    const byPhase: Record<string, number> = {};
    const byVendor: Record<string, number> = {};
    for (const e of this.entries) {
      byPhase[e.phase] = round6((byPhase[e.phase] ?? 0) + e.usd);
      byVendor[e.vendor] = round6((byVendor[e.vendor] ?? 0) + e.usd);
    }
    const total = round6(this.entries.reduce((n, e) => n + e.usd, 0));
    return { total_usd: total, by_phase: byPhase, by_vendor: byVendor, calls: this.entries.length };
  }
}

export type CostRow = {
  function_name: string;
  batch_id?: string | null;
  job_id?: string | null;
  theme?: string | null;
  day_count?: number | null;
  mode?: string | null;
  grounded?: boolean | null;
  request_id?: string | null;
  user_id?: string | null;
};

// Fail-soft by design: cost accounting must never take a generation down, and
// the table may not exist yet if the migration hasn't been pushed. The [cost]
// log line above every insert is the fallback record either way.
export async function persistCost(tracker: CostTracker, row: CostRow): Promise<void> {
  try {
    const client = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const s = tracker.summary();
    const { error } = await client.from("generation_costs").insert({
      ...row,
      total_usd: s.total_usd,
      by_vendor: s.by_vendor,
      by_phase: s.by_phase,
      entries: tracker.entries,
    });
    if (error) console.warn("[cost] persist failed (logged above instead):", error.message);
  } catch (err) {
    console.warn("[cost] persist failed (logged above instead):", err);
  }
}
