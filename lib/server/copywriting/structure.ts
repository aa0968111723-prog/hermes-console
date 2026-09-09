import {
  COPY_STRUCTURE,
  type CopyChannel,
  type CopyFacts,
  type CopyStructureSlot,
} from "./types";

const SLOT_PATTERNS: Record<CopyStructureSlot, RegExp> = {
  hook: /你是否|是不是也|剛(搬|來)|還在想|不知道要|晚上還|滑到這裡|先停一下|教授沒教/,
  relatable:
    /淡水|克難坡|通學|下雨|宿舍|社團博覽|社博|剛來淡大|課業|不知道加什麼|迷茫/,
  activity: /茶會|演講|社博|社課|擺攤|迎新|工作坊|坐一下|攤位/,
  whyJoin: /認識|朋友|休息|不用報名才|來看看|沒有考試|沒有壓力|低門檻|一起/,
  timePlace: /\d{1,2}\s*[\/月.]\s*\d{1,2}|週[一二三四五六日]|19:00|地點|時間/,
  cta: /報名|填表|表單|來坐|來攤位|留言|私訊|點連結|帶同學/,
};

const SLOT_LABELS: Record<CopyStructureSlot, string> = {
  hook: "HOOK",
  relatable: "生活場景",
  activity: "活動",
  whyJoin: "為什麼來",
  timePlace: "時間／地點",
  cta: "CTA",
};

export function detectStructure(text: string) {
  const flags = {} as Record<CopyStructureSlot, boolean>;
  const missing: string[] = [];
  for (const slot of COPY_STRUCTURE) {
    flags[slot] = SLOT_PATTERNS[slot].test(text);
    if (!flags[slot]) missing.push(SLOT_LABELS[slot]);
  }
  return { ...flags, missing };
}

export function emptyFacts(): CopyFacts {
  const unknown = { value: null, kind: "UNKNOWN" as const };
  return {
    name: { ...unknown },
    date: { ...unknown },
    time: { ...unknown },
    location: { ...unknown },
    formUrl: { ...unknown },
  };
}

function field(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || /待定|待確認|OOOO|TBD/i.test(trimmed))
    return { value: trimmed || null, kind: "UNKNOWN" as const };
  return { value: trimmed, kind: "FACT" as const };
}

export function normalizeFacts(input?: {
  name?: string | null;
  date?: string | null;
  time?: string | null;
  location?: string | null;
  formUrl?: string | null;
}): CopyFacts {
  return {
    name: field(input?.name),
    date: field(input?.date),
    time: field(input?.time),
    location: field(input?.location),
    formUrl: field(input?.formUrl),
  };
}

export function formatFromCopyFormat(
  format: "post" | "carousel" | "story" | "reel" | string,
): CopyChannel {
  if (format === "carousel") return "carousel";
  if (format === "story") return "story";
  if (format === "reel") return "reels_hook";
  return "ig_caption";
}
