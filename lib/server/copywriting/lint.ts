import { CHANNEL_LIMITS, type CopyChannel, type CopyLintIssue } from "./types";

const BANNED_DEFAULT = ["療癒", "能量", "宇宙", "靈性", "覺醒"];
const JARGON = ["靜定", "禪修", "禪定", "開示", "法會"];
const RELIGIOUS = ["法輪", "輪迴", "菩薩", "眾生", "修行因緣", "清淨"];
const PREACHY = ["破繭成蝶", "蛻變之路", "無雙模式", "漣漪擴散"];
const PLACEHOLDER = ["OOOO", "待定", "待確認", "TBD"];
const PRESSURE = ["一定要來", "錯過就沒了", "不來會後悔", "立刻報名不然"];

function hits(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(term));
}

export function lintCopy(input: {
  text: string;
  channel: CopyChannel;
  allowSpiritual?: boolean;
}): CopyLintIssue[] {
  const text = input.text || "";
  const issues: CopyLintIssue[] = [];
  const add = (
    kind: CopyLintIssue["kind"],
    term: string,
    message: string,
    severity: CopyLintIssue["severity"],
  ) => issues.push({ kind, term, message, severity });

  for (const term of hits(text, BANNED_DEFAULT)) {
    add(
      "banned",
      term,
      input.allowSpiritual
        ? "活動本身需要時可保留，但不要堆疊。"
        : "預設不要用這個詞；除非活動本身真的需要。",
      input.allowSpiritual ? "warn" : "block",
    );
  }
  for (const term of hits(text, JARGON)) {
    add(
      "jargon",
      term,
      "術語先出現新生容易滑掉；主標改生活場景，術語放副標。",
      "warn",
    );
  }
  for (const term of hits(text, RELIGIOUS)) {
    add(
      "religious",
      term,
      "對外文案不要像宗教宣傳。內部企劃用語不要直接上 IG。",
      "block",
    );
  }
  for (const term of hits(text, PREACHY)) {
    add("preachy", term, "說教感偏高，改成同學之間會講的話。", "warn");
  }
  for (const term of hits(text, PLACEHOLDER)) {
    add(
      "placeholder",
      term,
      "地點或欄位尚未確認，標 UNKNOWN，不要用假資料上稿。",
      "block",
    );
  }
  for (const term of hits(text, PRESSURE)) {
    add("pressure", term, "新生會覺得有壓力；改成來坐一下就好。", "warn");
  }

  const limit = CHANNEL_LIMITS[input.channel];
  if (text.length > limit.max) {
    add(
      "length",
      String(limit.max),
      `超過此渠道建議字數 ${limit.max}。`,
      "warn",
    );
  }
  const firstLine = text.split(/\r?\n/)[0] || "";
  if (limit.firstLineMax && firstLine.length > limit.firstLineMax) {
    add(
      "length",
      "hook",
      `第一行（HOOK）建議 ${limit.firstLineMax} 字內，手機才看得完。`,
      "warn",
    );
  }
  return issues;
}
