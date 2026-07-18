// Company Aliases & Normalisation for return policy lookup

export const COMPANY_ALIASES: Record<string, string> = {
  "searle": "the searle company",
  "gsk": "gsk pakistan",
  "sanofi": "sanofi-aventis",
  "abbott": "abbott laboratories",
  "abbott labs": "abbott laboratories",
  "abbott labs pak": "abbott laboratories",
  "haleon": "haleon pakistan",
  "bayer": "bayer pakistan",
  "sami": "sami pharmaceuticals",
  "high-q": "high-q pharmaceuticals",
  "hilton": "hilton pharma",
  "bosch": "bosch pharmaceuticals",
  "efroze": "efroze chemical industries",
  "genix": "genix pharma",
  "amros": "amros pharmaceuticals",
  "linz": "linz pharmaceuticals",
  "adamjee": "adamjee pharmaceuticals",
  "zafa": "zafa pharmaceutical labs",
  "nabiqasim": "nabiqasim industries",
  "macter": "macter international",
  "pharmatec": "pharmatec pakistan",
  "cibex": "cibex private limited",
  "alina combine": "alina combine pharma",
  "martin dow": "martin dow group",
  "agp": "agp limited",
  "aspin": "aspin pharma",
  "brette": "brette hudson",
  "hamdard": "hamdard laboratories",
  "herbion": "herbion international",
  "getz": "getz pharma",
  "ferozsons": "ferozsons laboratories",
  "horizon": "horizon pharmaceuticals",
  "platinum": "platinum pharmaceuticals",
  "nutrifactor": "nutrifactor laboratories"
};

/**
 * Normalise a company name by lowercasing, stripping common suffixes/punctuation,
 * and collapsing spaces.
 */
export function normaliseCompanyName(name: string): string {
  if (!name) return "";
  let normalised = name.toLowerCase().trim();
  
  // Remove common suffixes and punctuation
  normalised = normalised
    .replace(/\b(pvt|ltd|corp|co|inc|limited|private|pakistan|laboratories|laboratory|labs|industries|pharmaceuticals|pharma|chemical|wellness)\b/g, "")
    .replace(/[^\w\s-]/g, "") // remove non-word chars except spaces and hyphens
    .replace(/\s+/g, " ")     // collapse multiple spaces
    .trim();
    
  return normalised;
}

/**
 * Resolves a manufacturer name to its canonical name in the return policies.
 * Returns null if unresolved.
 */
export function resolveManufacturer(name: string): string | null {
  if (!name) return null;
  const directNorm = normaliseCompanyName(name);
  if (!directNorm) return null;

  // 1. Direct check in aliases
  if (COMPANY_ALIASES[directNorm]) {
    return COMPANY_ALIASES[directNorm];
  }

  // 2. Check if the normalised name is a key in COMPANY_ALIASES
  for (const [alias, canonical] of Object.entries(COMPANY_ALIASES)) {
    if (directNorm === alias || directNorm.includes(alias) || alias.includes(directNorm)) {
      return canonical;
    }
  }

  return null;
}
