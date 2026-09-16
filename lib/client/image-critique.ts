import type { TwinPanel } from "@/lib/server/audience/types";

export type ImageReadView = {
  materialId: string;
  kind: "image";
  mime?: string | null;
  title?: string;
  imageRead: true;
  nativeImageInput: boolean;
  notice: string;
};

export function isImageRead(value: unknown): value is ImageReadView {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.materialId !== "string" || item.materialId.length < 8)
    return false;
  if (item.kind !== "image" || item.imageRead !== true) return false;
  if (typeof item.nativeImageInput !== "boolean") return false;
  if (typeof item.notice !== "string" || !item.notice.trim()) return false;
  if (/已搜尋整個 Instagram|已看完整像素|轉換率/.test(item.notice))
    return false;
  return true;
}

export function critiqueLayers(read: ImageReadView, panel?: TwinPanel | null) {
  const unknowns = panel?.unknowns || [];
  const visualUnknown = unknowns.some((item) => /視覺|看圖/.test(item));
  const placeUnknown = unknowns.some((item) => /時間|地點/.test(item));
  return [
    {
      id: "image",
      label: "畫面",
      state: read.imageRead ? "已讀取" : "未讀取",
    },
    {
      id: "hierarchy",
      label: "視覺層級",
      state: !panel
        ? "尚未模擬"
        : visualUnknown
          ? "UNKNOWN"
          : "有視覺描述（模擬）",
    },
    {
      id: "place",
      label: "時間地點",
      state: !panel ? "尚未模擬" : placeUnknown ? "UNKNOWN" : "模擬已見線索",
    },
  ];
}

export function critiqueDirections(panel?: TwinPanel | null) {
  if (!panel) return [];
  const items = [...panel.unknowns];
  const drop = panel.personas.find(
    (persona) => persona.personaId === panel.mostLikelyToDrop,
  );
  if (drop) items.push(...drop.why);
  const pressure = panel.personas.find(
    (persona) => persona.personaId === panel.highestPressure,
  );
  if (pressure && pressure.personaId !== drop?.personaId)
    items.push(...pressure.why);
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    4,
  );
}

export function shortMaterialTitle(title?: string) {
  const value = (title || "上傳畫面").trim();
  return value.length > 28 ? value.slice(0, 28) + "…" : value;
}

export function critiqueFollowUp(direction: string) {
  return (
    "請依「" +
    direction.slice(0, 40) +
    "」修改這張已讀取的海報，沿用同一張圖，不要另起無關作品。"
  );
}
