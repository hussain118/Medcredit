// Karachi supply-chain return matrix. verified 2026-07-18.
// intimation_months: null = accepts returns anytime, no advance notice.
// grace_months: months AFTER expiry the return is still accepted.

export interface ReturnPolicy {
  intimation_months: number | null;
  grace_months: number;
}

export const RETURN_POLICIES: Record<string, ReturnPolicy> = {
  "getz pharma":                { intimation_months: null, grace_months: 2 },
  "ferozsons laboratories":     { intimation_months: null, grace_months: 2 },
  "horizon pharmaceuticals":    { intimation_months: null, grace_months: 2 },
  "platinum pharmaceuticals":   { intimation_months: null, grace_months: 2 },

  "abbott laboratories":        { intimation_months: 6, grace_months: 1 },
  "haleon pakistan":            { intimation_months: 6, grace_months: 1 },
  "novo nordisk":               { intimation_months: 6, grace_months: 0 },
  "nutrifactor laboratories":   { intimation_months: 6, grace_months: 0 }, // unopened only
  "gsk pakistan":               { intimation_months: 6, grace_months: 1 },
  "bayer pakistan":             { intimation_months: 6, grace_months: 1 },
  "sanofi-aventis":             { intimation_months: 6, grace_months: 1 },
  "sami pharmaceuticals":       { intimation_months: 6, grace_months: 2 },
  "the searle company":         { intimation_months: 6, grace_months: 2 },
  "high-q pharmaceuticals":     { intimation_months: 6, grace_months: 2 },
  "hilton pharma":              { intimation_months: 6, grace_months: 1 },
  "bosch pharmaceuticals":      { intimation_months: 6, grace_months: 2 },
  "efroze chemical industries": { intimation_months: 6, grace_months: 1 },
  "genix pharma":               { intimation_months: 6, grace_months: 1 },
  "amros pharmaceuticals":      { intimation_months: 6, grace_months: 1 },
  "linz pharmaceuticals":       { intimation_months: 6, grace_months: 1 },
  "adamjee pharmaceuticals":    { intimation_months: 6, grace_months: 1 },
  "uniferoze":                  { intimation_months: 6, grace_months: 1 },
  "zafa pharmaceutical labs":   { intimation_months: 6, grace_months: 2 },
  "nabiqasim industries":       { intimation_months: 6, grace_months: 2 },
  "macter international":        { intimation_months: 6, grace_months: 1 },
  "pharmatec pakistan":         { intimation_months: 6, grace_months: 1 },
  "cibex private limited":      { intimation_months: 6, grace_months: 1 },
  "alina combine pharma":       { intimation_months: 6, grace_months: 1 },
  "martin dow group":           { intimation_months: 6, grace_months: 1 },
  "agp limited":                { intimation_months: 6, grace_months: 1 },
  "aspin pharma":               { intimation_months: 6, grace_months: 1 },
  "brette hudson":              { intimation_months: 6, grace_months: 1 },
  "hamdard laboratories":       { intimation_months: 6, grace_months: 1 },
  "herbion international":      { intimation_months: 6, grace_months: 1 },
};

// Special-condition flags shown in the UI (do not affect date math):
// "novo nordisk": rejections apply once expired
// "nutrifactor laboratories": strictly unopened only
export const POLICY_NOTES: Record<string, string> = {
  "novo nordisk": "Rejections apply once expired — return before expiry.",
  "nutrifactor laboratories": "Unopened stock only.",
};

export const POLICY_META = { source: "Karachi supply-chain matrix", verified: "2026-07-18" };
