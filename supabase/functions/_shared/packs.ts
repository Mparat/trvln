// Credit packs. The credits-per-pack mapping lives server-side only — Stripe
// metadata carries the product_key, and this table is the authority on what a
// key grants, so a tampered client can never inflate a grant.
export const PACKS = {
  pack_2: { credits: 2, priceEnv: "STRIPE_PRICE_PACK_2" },
  pack_10: { credits: 10, priceEnv: "STRIPE_PRICE_PACK_10" },
} as const;

export type PackKey = keyof typeof PACKS;

export const isPackKey = (v: unknown): v is PackKey =>
  typeof v === "string" && v in PACKS;
