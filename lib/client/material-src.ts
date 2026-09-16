import type { Material } from "../contracts";

export type MaterialVisualKind = "image" | "pdf" | "link" | "text";

export function materialSrc(id: string, variant: "thumb" | "full" = "thumb") {
  const params = new URLSearchParams({ id });
  if (variant === "thumb") params.set("variant", "thumb");
  return "/api/materials?" + params.toString();
}

export function visualKind(
  material?: Pick<Material, "kind" | "mime" | "url"> | null,
): MaterialVisualKind {
  if (!material) return "text";
  if (material.kind === "image") return "image";
  if (material.mime === "application/pdf") return "pdf";
  if (material.kind === "reference" || material.url) return "link";
  return "text";
}

export function referenceHost(url?: string | null) {
  if (!url) return "連結";
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "連結";
  }
}
