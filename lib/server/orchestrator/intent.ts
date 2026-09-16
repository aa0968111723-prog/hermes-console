import type { IntentTier } from "../../contracts";
import { isDirectionPick } from "../../inspiration-pack";

export type { IntentTier };

/** Short follow-ups stay on the fast path; longer text without cues is create. */
export const FAST_INTENT_CHAR_LIMIT = 80;

const CHITCHAT =
  /^(嗯+|喔+|哦+|啊+|好+|是+|對+|ok+|okay|yes|no|謝謝|感謝|哈哈+|嗨+|你好|哈囉|hi|hello|收到|了解|知道了|沒問題)[\s!！。.~～?？…]*$/i;

const CONTINUE_CUE =
  /改(一?下|軟|短|長|語氣|顏色|標題)|再(短|長|改|試|寫|來)|語氣|繼續|剛剛|那個|換個|縮短|加長|潤稿|潤色/;

const LOOKUP = /研究|幫我查|查一?下|查詢|搜尋|文獻|資料來源|找資料|查資料|來源|議題|公告/;

const CREATE =
  /海報|網宣|Canva|canva|視覺|設計|稿|文宣|招新|茶會|三個方向|靈感|Lumen|lumen|FrameLab|framelab|畫板|創作|文案|caption|限動|Reels|reel|CTA|私訊|表單說明|hook|招生文案|海報標題|這張|哪裡可以改|視覺層級/;

export function hasCreateCue(input: string): boolean {
  return CREATE.test(input.trim());
}

export function classifyIntent(
  input: string,
  options?: { hasImage?: boolean },
): IntentTier {
  const text = input.trim();
  if (!text && !options?.hasImage) return "chitchat";
  if (options?.hasImage) return "create";
  if (LOOKUP.test(text)) return "lookup";
  if (isDirectionPick(text) || hasCreateCue(text)) return "create";
  if (CHITCHAT.test(text)) return "chitchat";
  if (text.length <= FAST_INTENT_CHAR_LIMIT || CONTINUE_CUE.test(text))
    return "continue";
  return "create";
}

export function isFastTier(tier: IntentTier) {
  return tier === "chitchat" || tier === "continue";
}
