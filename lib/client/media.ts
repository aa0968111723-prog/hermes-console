import type { Material } from "../contracts";

export function materialFileSrc(id: string) {
  return "/api/materials?id=" + encodeURIComponent(id);
}

export function materialThumbSrc(id: string) {
  return materialFileSrc(id) + "&variant=thumb";
}

export function isPdfMaterial(
  material?: Pick<Material, "mime" | "title"> | null,
  fileName?: string,
) {
  const name = fileName || material?.title || "";
  return material?.mime === "application/pdf" || /\.pdf$/i.test(name);
}

export function materialKindLabel(
  material?: Pick<Material, "kind" | "mime" | "title" | "url"> | null,
  fileName?: string,
) {
  if (isPdfMaterial(material, fileName)) return "PDF";
  if (material?.kind === "image") return "圖片";
  if (material?.kind === "text") return "文件";
  if (material?.kind === "reference") {
    try {
      return (
        new URL(material.url || "").hostname.replace(/^www\./, "") || "連結"
      );
    } catch {
      return "連結";
    }
  }
  if (fileName) {
    if (/\.(png|jpe?g|webp)$/i.test(fileName)) return "圖片";
    if (/\.txt$/i.test(fileName)) return "文件";
  }
  return "素材";
}
