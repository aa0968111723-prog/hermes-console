import { searchMemories } from "../hermes/memory.ts";
import { queryTkuCalendar, queryTkuVenues, getTkuZenClubProfile } from "../mcp/tamkang-adapter.ts";
import { searchInspirations } from "../inspiration/engine.ts";
import { simulateAudienceReaction } from "../audience-twin/engine.ts";
import type { AudienceScore, AudienceSimulationResult } from "../audience-twin/types.ts";
import { generateConfirmationToken } from "../mcp/registry.ts";

export interface CreativeDirection {
  id: string;
  title: string;
  subtitle: string;
  hook: string;
  coreInsight: string;
  visualConcept: string;
  colorPalette: { name: string; hex: string }[];
  audienceScores: AudienceScore;
  audienceFeedback: AudienceSimulationResult;
  canvaBlueprint: {
    title: string;
    dimensions: string;
    layers: Array<{ layer: number; type: string; content?: string; note?: string }>;
    exportDraftUrl: string;
  };
  igCaption: {
    hook: string;
    body: string;
    eventLogistics: string;
    callToAction: string;
    hashtags: string[];
  };
}

export interface CreativePipelineResult {
  query: string;
  executedAt: string;
  activeProject: string;
  assignedProfile: { id: string; name: string; role: string };
  contextMemories: Array<{ title: string; evidenceType: string; content: string }>;
  campusIntel: {
    currentWeekEvents: unknown;
    recommendedVenues: unknown;
    clubProfile: unknown;
  };
  inspirations: unknown[];
  directions: CreativeDirection[];
  topDirection: CreativeDirection;
  actionConfirmation: {
    token: string;
    expiresAt: number;
    actionName: string;
    toolTarget: string;
  };
}

export async function runCreativeIntelligencePipeline(
  userQuery: string,
  options?: { activeProject?: string; sessionKey?: string }
): Promise<CreativePipelineResult> {
  const project = options?.activeProject || "tku-zen-agent";

  // 1. 檢索校園記憶
  const relevantMemories = searchMemories(userQuery, project).map((m) => ({
    title: m.title,
    evidenceType: m.evidenceType,
    content: m.content
  }));

  // 2. 調用 Tamkang MCP 適配器
  const calendarEvent = await queryTkuCalendar(2);
  const venues = await queryTkuVenues();
  const clubProfile = getTkuZenClubProfile();

  // 3. 調用靈感引擎
  const inspirations = searchInspirations("淡水");

  // 4. 建構 4 個差異化策略創意方向
  const rawDirections = [
    {
      id: "dir_kenan_recharge",
      title: "克難坡登頂後的 15 分鐘心靈茶席",
      subtitle: "腿酸先歇會兒・大腦瞬間重開機",
      hook: "到底誰發明了 132 階克難坡？爬上來的大一新生，這杯冷泡茶我們請你喝。",
      coreInsight: "大一開學最普遍的生理與心理痛點就是通勤爬坡。將『體能疲累』直接轉化為『放下重擔進來喝茶』的共鳴情境，無說教感。",
      visualConcept: "日系戶外雜誌風格。畫面以淡水晨光、克難坡綠意階梯與手作陶茶碗為視覺重心，右下角點綴 36px 手作圓形三色光小印章，留白通透。",
      colorPalette: [
        { name: "靜謐深竹綠", hex: "#2E4036" },
        { name: "溫潤米紙白", hex: "#F7F5EE" },
        { name: "陶土茶韻褐", hex: "#C29B7F" },
        { name: "朝陽晨光金", hex: "#E5C287" }
      ]
    },
    {
      id: "dir_brain_reboot",
      title: "大一的腦袋過熱重開機模式",
      subtitle: "選課搶不到・搶到一席清幽心靈綠洲",
      hook: "選課系統轉圈圈、課表排得心好累？教你 5 分鐘關掉大腦雜訊的專注放鬆禪。",
      coreInsight: "新生開學前三週的巨大焦慮源自資訊轟炸與搶課挫折。主打『科學腹式呼吸』與『大一選課不踩雷經驗分享』，具備超強實用性。",
      visualConcept: "極簡科技人文感。冷杉灰綠與霧白底色，象徵清空大腦暫存快取（Cache），視覺無壓且高級。",
      colorPalette: [
        { name: "冷杉清灰綠", hex: "#4A6357" },
        { name: "極簡月光白", hex: "#FAFAF8" },
        { name: "琥珀茶湯金", hex: "#D4A359" },
        { name: "墨色沉澱黑", hex: "#232B28" }
      ]
    },
    {
      id: "dir_fuyuan_twilight",
      title: "福園黑天鵝池畔的午後微光慢活",
      subtitle: "零社交壓力・想靜靜喝杯茶就來",
      hook: "在淡江，最奢侈的不是早八睡飽，而是在傍晚的福園，吹著微風喝一杯剛泡好的高山茶。",
      coreInsight: "很多內向（I人）新生渴望社交卻排斥吵鬧迎新。保證『絕不強迫上台、零尷尬破冰、純品茶聊天』，徹底卸下防備心。",
      visualConcept: "文藝水波意象。福園池畔黑天鵝優雅倒影，搭配宮燈大道溫暖斜陽，氛圍感滿分，極適合拍照轉發。",
      colorPalette: [
        { name: "黛藍深湖水", hex: "#1F2F2D" },
        { name: "溫暖燕麥白", hex: "#EDE8DF" },
        { name: "茶韻焦糖褐", hex: "#B87A4B" },
        { name: "夕暮微光粉", hex: "#D8A499" }
      ]
    }
  ];

  // 5. 針對每個方向執行 Audience Twin 受眾雙生模擬與評分
  const directions: CreativeDirection[] = rawDirections.map((dir) => {
    const simulation = simulateAudienceReaction(
      dir.title,
      dir.coreInsight,
      dir.visualConcept,
      dir.hook,
      project
    );

    const canvaBlueprint = {
      title: `${dir.title} (Canva 1080x1350)`,
      dimensions: "1080x1350 (IG 最佳 4:5 直式直拍比例)",
      layers: [
        { layer: 1, type: "background", note: `主色調 ${dir.colorPalette[1].hex} (${dir.colorPalette[1].name}) 柔和無壓底色` },
        { layer: 2, type: "visual_mask", note: "上方 60% 預留自然光茶席或校園地標散景攝影" },
        { layer: 3, type: "headline", content: dir.title, note: "思源宋體 Bold 44pt，文字對齊中央微靠左" },
        { layer: 4, type: "hook_subtitle", content: dir.subtitle, note: "思源黑體 Regular 20pt，增加字距 0.1em" },
        { layer: 5, type: "three_color_seal", note: "手作圓形三色光印章（紅外、黃中、綠內）直徑 36px 置於右下角，規範落款" },
        { layer: 6, type: "event_badge", content: "【淡江領袖禪學社・新生迎新茶會】免費入場・備有點心", note: "底部深色圓角膠囊標籤" }
      ],
      exportDraftUrl: `https://www.canva.com/design/draft?theme=${encodeURIComponent(dir.id)}`
    };

    const igCaption = {
      hook: `🌿 ${dir.hook}`,
      body: [
        `開學第一週，你是不是也這樣？`,
        `剛爬完克難坡 132 階喘到懷疑人生，`,
        `轉頭還要面對滿江紅的選課系統與陌生的教室⋯⋯`,
        ``,
        `給自己一個按下 Pause 的下午吧！`,
        `不談玄學、不講大道理，`,
        `這裡只有現泡的清香冷泡茶、手作點心，`,
        `還有學長姐最真實的『淡江選課不踩雷求生指南』。`,
        ``,
        `✨【保證亮點】：`,
        `✔ 零社交壓力：不用尷尬自我介紹，純喝茶聊天放空`,
        `✔ 專注放鬆禪體驗：5 分鐘學會深層呼吸，清空大腦雜訊`,
        `✔ 完全免費：歡迎帶室友或好朋友一起來喝一杯好茶`
      ].join("\n"),
      eventLogistics: [
        `📅 時間：開學第二週 每週二 18:30 - 20:00`,
        `📍 地點：學生活動中心 3 樓多功能社團教室（或宮燈長廊）`,
        `🍵 費用：完全免費（備有精緻茶點與手作小禮）`
      ].join("\n"),
      callToAction: `👉 點擊個人檔案自介連結預約席位，或留言「+1」小編私訊保留限定茶點份量！`,
      hashtags: [
        "#淡江大學", "#淡江禪學社", "#克難坡日常", "#淡江大一新生",
        "#選課不踩雷", "#宮燈教室", "#大腦重開機", "#大學社團生活", "#茶會"
      ]
    };

    return {
      id: dir.id,
      title: dir.title,
      subtitle: dir.subtitle,
      hook: dir.hook,
      coreInsight: dir.coreInsight,
      visualConcept: dir.visualConcept,
      colorPalette: dir.colorPalette,
      audienceScores: simulation.scores,
      audienceFeedback: simulation,
      canvaBlueprint,
      igCaption
    };
  });

  // 排序選出最佳方向
  const sorted = [...directions].sort((a, b) => b.audienceScores.overallScore - a.audienceScores.overallScore);
  const topDirection = sorted[0];

  // 產生敏感發布確認 Token
  const conf = generateConfirmationToken("發布至社群與 Canva 草稿", "publish_social_campaign", {
    platform: "instagram",
    caption: topDirection.igCaption.hook
  });

  return {
    query: userQuery,
    executedAt: new Date().toISOString(),
    activeProject: project,
    assignedProfile: {
      id: "tku",
      name: "淡江校園脈絡專家",
      role: "Tamkang Campus Specialist & Creative Orchestrator"
    },
    contextMemories: relevantMemories,
    campusIntel: {
      currentWeekEvents: calendarEvent,
      recommendedVenues: venues,
      clubProfile
    },
    inspirations,
    directions: sorted,
    topDirection,
    actionConfirmation: {
      token: conf.token,
      expiresAt: conf.expiresAt,
      actionName: "發布 Instagram 網宣與同步至 Canva",
      toolTarget: "publish_social_campaign"
    }
  };
}
