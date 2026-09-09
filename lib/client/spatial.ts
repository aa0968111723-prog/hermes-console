export type SpatialMode = "full" | "reduced" | "static";
export function spatialMode(input: {
  animation: boolean;
  reduceMotion: boolean;
  saveData?: boolean;
  cores?: number;
  memory?: number;
  mobile: boolean;
}): SpatialMode {
  if (!input.animation || input.reduceMotion) return "static";
  if (
    input.saveData ||
    (input.cores !== undefined && input.cores <= 4) ||
    (input.memory !== undefined && input.memory <= 4) ||
    input.mobile
  )
    return "reduced";
  return "full";
}
export function importantNodes<
  T extends { id: string; status: string; tools: string[] },
>(nodes: T[], tool: string | null, limit: number): T[] {
  const matching = (n: T) =>
    !!tool &&
    (n.tools.includes(tool) ||
      tool.toLowerCase().startsWith(n.id.toLowerCase() + "_"));
  return nodes
    .filter(
      (n) =>
        matching(n) || ["available", "partial", "failed"].includes(n.status),
    )
    .sort(
      (a, b) =>
        Number(matching(b)) - Number(matching(a)) ||
        Number(b.status === "available") - Number(a.status === "available"),
    )
    .slice(0, Math.max(0, limit));
}
