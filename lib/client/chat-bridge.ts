/**
 * 創意智能方向與對話工作台深聊橋樑工具
 * Hermes Creative Intelligence OS - Chat Bridge
 */
import type { CreativeDirection } from "@/lib/server/creative-workflow/pipeline.ts";

export type ExtensionTopic =
  | "host_script"       // 活動破冰主持講稿
  | "interactive_cards" // 迎新現場互動問答卡
  | "story_script"      // IG 限時動態 3 篇腳本
  | "custom_chat";      // 自由深聊此方向

export interface ChatBridgeOption {
  direction: CreativeDirection;
  domain?: string;
  topic: ExtensionTopic;
  customPrompt?: string;
}

/**
 * 依據延伸創作主題生成結構化的深聊 Prompt
 */
export function buildDirectionChatPrompt(options: ChatBridgeOption): string {
  const { direction, domain = "tamkang", topic, customPrompt } = options;
  const campusPrefix =
    domain === "ntu"
      ? "【臺灣大學】"
      : domain === "general"
      ? "【大專院校】"
      : "【淡江大學】";

  switch (topic) {
    case "host_script":
      return `我想深入討論 ${campusPrefix} 創意方向「${direction.title}」（方向 ID: ${direction.id}）。
請為我撰寫一份「活動當天 3 分鐘破冰主持講稿」，要求：
1. 開場能呼應核心第一眼 Hook「${direction.hook}」，迅速抓住大一新生注意。
2. 主持風格貼合視覺概念「${direction.visualConcept}」，親切溫和、零推銷感。
3. 明確引導茶席或交流體驗，讓內向新生感到安心舒適。`;

    case "interactive_cards":
      const colorNames = direction.colorPalette.map((c) => c.name).join("、");
      return `我想深入討論 ${campusPrefix} 創意方向「${direction.title}」（方向 ID: ${direction.id}）。
請為我規劃「迎新茶會現場 5 張破冰互動問答卡」，要求：
1. 每張卡片包含一個貼近新生校園生活（如選課、校園地標、減壓放鬆）的趣味話題。
2. 融入主色調「${colorNames}」的卡片視覺設計建議。
3. 題目零社交防禦心，讓互不認識的新生能輕鬆展開話題。`;

    case "story_script":
      return `我想深入討論 ${campusPrefix} 創意方向「${direction.title}」（方向 ID: ${direction.id}）。
請為我規劃「Instagram 限時動態 (Story) 3 篇連續發布腳本」，要求：
1. 第一篇（倒數前兩天）：痛點引子與好奇心勾動。
2. 第二篇（倒數前一天）：公布活動亮點與安心保證（如完全免費、學長姐真實避雷心得）。
3. 第三篇（活動當天）：地點動線導引與現場備茶實況。
4. 包含 9:16 視覺畫面建議與互動貼圖（投票/問答）設計。`;

    case "custom_chat":
    default:
      if (customPrompt && customPrompt.trim()) {
        return `我想針對 ${campusPrefix} 創意方向「${direction.title}」（副標：${direction.subtitle}）討論：
${customPrompt.trim()}`;
      }
      return `我想深入討論 ${campusPrefix} 創意方向「${direction.title}」（方向 ID: ${direction.id}）。
其核心受眾洞察為「${direction.coreInsight}」，視覺調性為「${direction.visualConcept}」。
請身為專案創意總監與校園專家，為我提供下一步深化執行的具體建議。`;
  }
}

export interface ExtensionShortcut {
  topic: ExtensionTopic;
  icon: string;
  label: string;
  desc: string;
}

export const EXTENSION_SHORTCUTS: ExtensionShortcut[] = [
  { topic: "host_script", icon: "🎤", label: "破冰主持講稿", desc: "3 分鐘親和開場白" },
  { topic: "interactive_cards", icon: "🏷️", label: "現場互動卡", desc: "5 張新生破冰話題" },
  { topic: "story_script", icon: "📱", label: "IG 限動 3 篇腳本", desc: "9:16 倒數發布動線" },
  { topic: "custom_chat", icon: "💬", label: "深度對話討論", desc: "自訂主題深入交流" },
];
