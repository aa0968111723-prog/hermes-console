export type DirectionCardView = {
  title: string;
  claim?: string;
  visual?: string;
};

export type DirectionSetView = {
  id: string;
  brief?: string;
  state: string;
  selected: number | null;
  directions: DirectionCardView[];
};

export function isDirectionSet(value: unknown): value is DirectionSetView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id.length < 8) return false;
  if (typeof item.state !== "string") return false;
  if (item.selected != null && typeof item.selected !== "number") return false;
  if (item.fullSiteSearch === false || item.imageRead === true) return false;
  if (item.simulation === true) return false;
  if (!Array.isArray(item.directions)) return false;
  if (item.directions.length < 3 || item.directions.length > 5) return false;
  return item.directions.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const card = entry as { title?: unknown };
    return typeof card.title === "string" && card.title.trim().length > 0;
  });
}

export function directionFollowUp(
  workflowId: string,
  index: number,
  title: string,
) {
  return (
    "已選定「" +
    title.slice(0, 40) +
    "」。請依這個方向製作草稿，沿用創作流程 " +
    workflowId +
    " 第 " +
    (index + 1) +
    " 個方向，不要另起無關作品。"
  );
}
