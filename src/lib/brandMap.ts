// Brand to Manufacturer Mapping

export const SEED_BRAND_TO_MAKER: Record<string, string | null> = {
  "brufen":       "abbott laboratories",
  "surbex-z":     "abbott laboratories",
  "surbex z":     "abbott laboratories",
  "lipiget":      "gsk pakistan",
  "velosef":      "gsk pakistan",
  "panadol extra":"haleon pakistan",
  "panadol":      "haleon pakistan",
  "cac-1000":     "haleon pakistan",
  "cac 1000":     "haleon pakistan",
  "empaa":        "horizon pharmaceuticals",
  "rivotril":     "martin dow group",
  "vitrumod":     null,   // Bill A - founder to confirm the true maker (or user adds inline)
};

/**
 * Normalises a brand name for mapping lookup.
 */
export function normaliseBrandName(brandName: string): string {
  if (!brandName) return "";
  return brandName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " "); // collapse multiple spaces
}

/**
 * Gets the mapped manufacturer for a brand name.
 * Checks user-defined mappings (from localStorage) first, then seeded mappings.
 */
export function resolveBrandToManufacturer(
  brandName: string, 
  userMappings: Record<string, string | null> = {}
): string | null | undefined {
  if (!brandName) return undefined;
  const norm = normaliseBrandName(brandName);

  // 1. Try to find an exact match in user mappings
  if (norm in userMappings) {
    return userMappings[norm];
  }

  // 2. Try to find an exact match in seeded mappings
  if (norm in SEED_BRAND_TO_MAKER) {
    return SEED_BRAND_TO_MAKER[norm];
  }

  // 3. Try partial word matching for brand names (e.g., if brand name contains "brufen")
  for (const [key, maker] of Object.entries(userMappings)) {
    if (norm.includes(key)) {
      return maker;
    }
  }

  for (const [key, maker] of Object.entries(SEED_BRAND_TO_MAKER)) {
    if (norm.includes(key)) {
      return maker;
    }
  }

  // If absolutely no mapping is found, return undefined (needs mapping)
  return undefined;
}
