import type { CopyChannel, CopyFacts } from "./types";
import { normalizeFacts } from "./structure";

export const VARIANT_LABELS = {
  a: "最自然",
  b: "最有梗",
  c: "最溫暖",
} as const;

function placeLine(facts: CopyFacts) {
  if (facts.location.kind === "FACT" && facts.location.value)
    return "地點 " + facts.location.value;
  return "地點還沒定，先標 UNKNOWN，確定再補。";
}

function whenLine(facts: CopyFacts) {
  const bits = [facts.date.value, facts.time.value].filter(Boolean);
  return bits.length ? bits.join(" ") : "時間還沒確認。";
}

/** Rule scaffolds from confirmed facts only. Not Hermes generation. */
export function scaffoldVariants(input: {
  channel?: CopyChannel;
  facts?: Parameters<typeof normalizeFacts>[0];
  kind?: "fair" | "tea" | "talk" | "generic";
}) {
  const facts = normalizeFacts(input.facts);
  const place = placeLine(facts);
  const when = whenLine(facts);
  const kind = input.kind || "generic";
  const a =
    kind === "fair"
      ? `剛來淡大還在逛社博的話，來坐一下就好。\n沒有要你立刻決定加入。玩個專注力遊戲，有機會把手搖帶回去。\n${when}\n${place}`
      : kind === "tea"
        ? `剛搬來淡水，晚上還在想社團要不要加？\n茶會來坐一下就好，沒有考試也沒有壓力。\n${when}\n${place}\n想去就填表。`
        : kind === "talk"
          ? `想搞懂自己最近怎麼做選擇，又怕講座很沉重？\n來聽就好，聽完再決定要不要留下。\n${when}\n${place}`
          : `有一個活動可以來坐一下。\n${when}\n${place}`;
  const b =
    kind === "fair"
      ? `社博逛到腳痠？先贏杯手搖再決定要不要加。\n${when}，${place}。路過也可以。`
      : kind === "tea"
        ? `教授沒教的大腦休息法：週三晚上來坐一下。\n${when}\n${place}`
        : `先來看看，不好奇也沒關係。\n${when}\n${place}`;
  const c =
    kind === "fair"
      ? `還不知道大學要做什麼也沒關係。\n來晃一下就好，我們不會抓你填一堆表。\n${when}\n${place}`
      : kind === "tea"
        ? `內向、怕被點名也沒關係。茶會可以只坐著聽。\n${when}\n${place}`
        : `可以帶一個同學，也可以自己來。\n${when}\n${place}`;
  return {
    method: "rule_scaffold" as const,
    publish: false as const,
    variants: { a, b, c },
    facts,
    note: "只填已提供事實；地點未確認不捏造教室。不是 Hermes 生成，也不是已發佈。",
  };
}
