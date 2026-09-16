import type { Material } from "../contracts";

export type AttachmentCoverKind = "image" | "pdf" | "link" | "file";

export function attachmentCoverKind(material: Material): AttachmentCoverKind {
  if (material.kind === "image") return "image";
  if (material.mime === "application/pdf") return "pdf";
  if (material.kind === "reference") return "link";
  return "file";
}

export function attachmentKindLabel(material: Material) {
  const kind = attachmentCoverKind(material);
  if (kind === "image") return "圖片";
  if (kind === "pdf") return "PDF";
  if (kind === "file") return "文件";
  if (!material.url) return "連結";
  try {
    return new URL(material.url).hostname.replace(/^www\./, "");
  } catch {
    return "連結";
  }
}

export function attachmentCoverMark(material: Material) {
  const label = attachmentKindLabel(material);
  const mark = Array.from(label)[0] || "鏈";
  return mark.toUpperCase();
}
