import type {
  FunnelLane,
  Material,
  MaterialSource,
  MaterialSourceType,
} from "../contracts";

/**
 * Materials × Inspiration lane derivation (§3.3-A).
 * Pure read-time mapping onto FunnelLane — zero migration / no persisted lane column.
 * Hard bans: public_index never roster/FACT; unlabeled / web_https never silent-upgrade to FACT.
 */

const MATERIAL_LANE: Record<MaterialSourceType, FunnelLane> = {
  drive_fact: "FACT",
  inspiration: "INSPIRATION",
  web_https: "none",
  upload: "none",
  line_export: "none",
  unknown: "none",
};

/** Derive FunnelLane from a material's source.type. Missing / unknown → none. */
export function laneForMaterial(
  material:
    | Pick<Material, "source">
    | { source?: MaterialSource | null }
    | null
    | undefined,
): FunnelLane {
  const type = material?.source?.type;
  if (!type) return "none";
  return MATERIAL_LANE[type] ?? "none";
}

/**
 * Inspiration store is fail-closed INSPIRATION (§3.3-A).
 * public_index (sheets-sync) is hard-banned from roster / drive_fact / FACT.
 * No DB lane column — always derive.
 */
export function laneForInspiration(
  item?: { sourceType?: string } | null,
): FunnelLane {
  // Document hard ban: even public_index (and any future mistype) stays INSPIRATION.
  void item?.sourceType;
  return "INSPIRATION";
}