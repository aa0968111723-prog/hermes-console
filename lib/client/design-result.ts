function isCanvaHost(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com")) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export type DesignView = Record<string, unknown> & {
  id?: string;
  title?: string;
  url?: string;
  urls?: { edit_url?: string; view_url?: string };
  thumbnail?: { url?: string };
};

export function isCanvaDesign(value: unknown): value is DesignView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.fullSiteSearch === false || item.imageRead === true) return false;
  if (item.simulation === true || item.truth === "SIMULATION") return false;
  const urls = item.urls as { edit_url?: unknown; view_url?: unknown } | undefined;
  const thumbnail = item.thumbnail as { url?: unknown } | undefined;
  const url = typeof item.url === "string" ? item.url : "";
  const edit = typeof urls?.edit_url === "string" ? urls.edit_url : "";
  const view = typeof urls?.view_url === "string" ? urls.view_url : "";
  const thumb = typeof thumbnail?.url === "string" ? thumbnail.url : "";
  return [url, edit, view, thumb].some(
    (href) => typeof href === "string" && isCanvaHost(href),
  );
}

export function designFromResult(value: unknown): {
  design: DesignView;
  artifactId?: string;
} | null {
  if (!value || typeof value !== "object") return null;
  if (isCanvaDesign(value)) {
    const design = value;
    return {
      design,
      artifactId: typeof design.id === "string" ? design.id : undefined,
    };
  }
  const item = value as Record<string, unknown>;
  if (isCanvaDesign(item.design)) {
    return {
      design: item.design,
      artifactId: typeof item.id === "string" ? item.id : undefined,
    };
  }
  if (item.job && typeof item.job === "object") {
    const job = item.job as Record<string, unknown>;
    if (job.result) return designFromResult(job.result);
  }
  return null;
}
