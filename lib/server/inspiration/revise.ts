import type { DirectionBriefPack } from "../../direction-brief";

const TYPE_ENLARGE =
  /第二版|第\s*2\s*版|字放大|字再大|標題大|主標大|放大標題|字級加大|改大字/;
const WARMER = /偏暖|改暖|暖色|暖一點|顏色.{0,8}暖|配色.{0,8}暖/;
const COOLER = /偏冷|改冷|冷色|冷一點|顏色.{0,8}冷|配色.{0,8}冷/;
const SOFTER = /語氣.{0,6}(軟|溫|柔)|改軟|軟一點|潤色|潤稿/;
const SHORTER = /改短|縮短|再短|字少|少一點字|限動.{0,8}短/;
const CONTINUE_SAME_WORK =
  /接續修改同一作品|修改這個作品|繼續改這[個件]作品/;
const MAKE_SELECTED_POSTER =
  /出圖|做(成|一張)?.{0,8}海報|做(成|一張)?.{0,8}網宣|做成?\s*Canva|幫我做海報|幫我做一張/;
const NEW_DIRECTION = /再找|換方向|其他方向|重新找|再找靈感|找靈感/;
const REVISION_FOOTER = "規則修訂，不是出圖。";

export const CONTINUE_SAME_WORK_PROMPT = "請接續修改同一作品。";

export type SpecRevisionKind =
  | "type_enlarge"
  | "warmer"
  | "cooler"
  | "softer"
  | "shorter";

export function specRevisionKind(text: string): SpecRevisionKind | null {
  const value = text.trim();
  if (!value || NEW_DIRECTION.test(value) || MAKE_SELECTED_POSTER.test(value))
    return null;
  if (TYPE_ENLARGE.test(value)) return "type_enlarge";
  if (SHORTER.test(value)) return "shorter";
  if (SOFTER.test(value)) return "softer";
  if (WARMER.test(value)) return "warmer";
  if (COOLER.test(value)) return "cooler";
  return null;
}

export function specRevisionLabel(kind: SpecRevisionKind): string {
  if (kind === "type_enlarge") return "主標加大";
  if (kind === "warmer") return "配色偏暖";
  if (kind === "cooler") return "配色偏冷";
  if (kind === "softer") return "語氣偏軟";
  return "文案縮短";
}

export function isSpecRevisionRequest(text: string) {
  return specRevisionKind(text) !== null;
}

export function isMakeSelectedPosterRequest(text: string) {
  const value = text.trim();
  if (!value || NEW_DIRECTION.test(value)) return false;
  return MAKE_SELECTED_POSTER.test(value);
}

export function isContinueSameWorkRequest(text: string) {
  const value = text.trim();
  return (
    (CONTINUE_SAME_WORK.test(value) || isMakeSelectedPosterRequest(value)) &&
    !isSpecRevisionRequest(value)
  );
}

function withRevisionMark(
  brief: DirectionBriefPack,
  mark: string,
  hintPrefix: string,
  copyMap?: (text: string) => string,
): DirectionBriefPack {
  const alreadyNoted = brief.visualNote?.includes(mark);
  const copy = copyMap
    ? {
        a: copyMap(brief.copy.a),
        b: copyMap(brief.copy.b),
        c: copyMap(brief.copy.c),
      }
    : brief.copy;
  const formats = brief.formats.map((format) => ({
    ...format,
    compositionHint: format.compositionHint.includes(hintPrefix)
      ? format.compositionHint
      : hintPrefix + format.compositionHint,
  }));
  const copyChanged =
    copy.a !== brief.copy.a ||
    copy.b !== brief.copy.b ||
    copy.c !== brief.copy.c;
  if (alreadyNoted && !copyChanged) return brief;
  const head = (brief.visualNote || "").replace(REVISION_FOOTER, "").trim();
  const marks = head.includes(mark) ? head : [head, mark + "。"].filter(Boolean).join("");
  return {
    ...brief,
    copy,
    formats,
    visualNote: marks + REVISION_FOOTER,
  };
}

function softenCopy(text: string) {
  return text
    .replace(/想去就填表。?/g, "想來再填也沒關係。")
    .replace(/沒有要你立刻決定加入。?/g, "先坐一下就好。");
}

function shortenCopy(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 2) return text;
  const hook = lines[0];
  const facts = lines.filter((line) => /時間|地點|填表/.test(line));
  const next = [hook, ...facts.filter((line) => line !== hook)];
  return next.join("\n");
}

export function applyTypeEnlarge(brief: DirectionBriefPack): DirectionBriefPack {
  return withRevisionMark(brief, "主標加大", "主標加大。");
}

export function applySpecRevision(
  brief: DirectionBriefPack,
  kind: SpecRevisionKind,
): DirectionBriefPack {
  if (kind === "type_enlarge") return applyTypeEnlarge(brief);
  if (kind === "warmer") return withRevisionMark(brief, "配色偏暖", "配色偏暖。");
  if (kind === "cooler") return withRevisionMark(brief, "配色偏冷", "配色偏冷。");
  if (kind === "softer")
    return withRevisionMark(brief, "語氣偏軟", "語氣偏軟。", softenCopy);
  return withRevisionMark(brief, "文案縮短", "文案縮短。", shortenCopy);
}
