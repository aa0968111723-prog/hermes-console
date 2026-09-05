import { searchMemories } from "../hermes/memory.ts";
import { queryTkuCalendar, queryTkuVenues, getTkuZenClubProfile } from "../mcp/tamkang-adapter.ts";
import { searchInspirations } from "../inspiration/engine.ts";
import { resolveContextDomain } from "../audience-twin/engine.ts";
import type { AudienceScore, AudienceSimulationResult } from "../audience-twin/types.ts";
import { generateConfirmationToken } from "../mcp/registry.ts";
import { getSocialLogisticsForDomain } from "./directions.ts";
import { researchInstagramTrends, type InstagramResearchReport } from "../social/instagram-research.ts";
import { runResearchAudienceDirectionWorkflow } from "../creative/research-direction-workflow.ts";
import { connectCreativeToCanva } from "../creative/canva-workflow.ts";

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
    mode?: string;
    created?: false;
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
  instagramResearch?: InstagramResearchReport;
  research?: ReturnType<typeof runResearchAudienceDirectionWorkflow>["research"];
  researchAudienceWorkflow?: {
    domain: string;
    connected: string[];
    method: "ai_heuristic";
    topDirectionId: string;
  };
}

export async function runCreativeIntelligencePipeline(
  userQuery: string,
  options?: { activeProject?: string; sessionKey?: string }
): Promise<CreativePipelineResult> {
  const project = options?.activeProject || "tku-zen-agent";
  const domain = resolveContextDomain(userQuery, project);
  const logistics = getSocialLogisticsForDomain(domain);
  const workflow = runResearchAudienceDirectionWorkflow({
    prompt: userQuery,
    projectId: project,
  });

  // 1. 檢索校園記憶
  const relevantMemories = searchMemories(userQuery, project).map((m) => ({
    title: m.title,
    evidenceType: m.evidenceType,
    content: m.content
  }));

  // 2. 校園研究：淡江才呼叫 Tamkang adapter；其他領域用 domain research bundle
  const calendarEvent =
    domain === "tamkang"
      ? await queryTkuCalendar(2)
      : { source: "console_notes", mcpVerified: false, note: "非淡江脈絡，未呼叫 Tamkang MCP" };
  const venues = domain === "tamkang" ? await queryTkuVenues() : { source: "console_notes", mcpVerified: false };
  const clubProfile = domain === "tamkang" ? getTkuZenClubProfile() : { source: "console_notes", mcpVerified: false };

  // 3. 調用靈感引擎
  const searchKeyword = domain === "ntu" ? "臺大" : domain === "tamkang" ? "淡水" : "校園";
  const inspirations = searchInspirations(searchKeyword, domain);

  // 4–5. 研究摘要 → 受眾模擬 → 方向排序（同一套 workflow）
  const directions: CreativeDirection[] = workflow.ranked.map((item) => {
    const dir = item.raw;
    const simulation = item.simulation;

    const canvaWorkflow = connectCreativeToCanva({
      title: dir.title,
      subtitle: dir.subtitle,
      copy: dir.coreInsight,
      cta: logistics.badgeContent,
      visual: dir.visualConcept,
      coreIdea: dir.coreInsight,
      claim: dir.hook,
      layers: [
        { layer: 1, type: "background", note: `主色調 ${dir.colorPalette[1].hex} (${dir.colorPalette[1].name}) 柔和無壓底色` },
        { layer: 2, type: "visual_mask", note: "上方 60% 預留自然光茶席或校園地標散景攝影" },
        { layer: 3, type: "headline", content: dir.title, note: "思源宋體 Bold 44pt，文字對齊中央微靠左" },
        { layer: 4, type: "hook_subtitle", content: dir.subtitle, note: "思源黑體 Regular 20pt，增加字距 0.1em" },
        { layer: 5, type: "three_color_seal", note: "手作圓形三色光印章（紅外、黃中、綠內）直徑 36px 置於右下角，規範落款" },
        { layer: 6, type: "event_badge", content: logistics.badgeContent, note: "底部深色圓角膠囊標籤" }
      ],
    });
    const canvaBlueprint = canvaWorkflow.blueprint;

    let captionBody: string;
    if (domain === "ntu") {
      captionBody = [
        `開學第一週，你是不是也這樣？`,
        `初到公館在椰林大道迷路、找不到腳踏車停哪，`,
        `轉頭還要面對選課系統搶通識與滿滿的原文書課表⋯⋯`,
        ``,
        `給自己一個按下 Pause 的下午吧！`,
        `不談玄學、不講大道理，`,
        `這裡只有現泡的清香冷泡茶、手作點心，`,
        `還有學長姐最真實的『臺大通識求生與雙主修避雷指南』。`,
        ``,
        `✨【保證亮點】：`,
        `✔ 零社交壓力：不用尷尬自我介紹，純喝茶聊天放空`,
        `✔ 專注放鬆禪體驗：5 分鐘學會深層呼吸，清空大腦雜訊`,
        `✔ 完全免費：歡迎帶室友或好朋友一起來喝一杯好茶`
      ].join("\n");
    } else if (domain === "general") {
      captionBody = [
        `開學第一週，你是不是也這樣？`,
        `初入大學校園面對陌生的環境與人群，`,
        `轉頭還要面對選課排課與生活步調的大轉變⋯⋯`,
        ``,
        `給自己一個按下 Pause 的下午吧！`,
        `不談玄學、不講大道理，`,
        `這裡只有現泡的清香冷泡茶、精緻點心，`,
        `還有學長姐最真實的『大學選課不踩雷求生指南』。`,
        ``,
        `✨【保證亮點】：`,
        `✔ 零社交壓力：不用尷尬自我介紹，純喝茶聊天放空`,
        `✔ 專注放鬆禪體驗：5 分鐘學會深層呼吸，清空大腦雜訊`,
        `✔ 完全免費：歡迎帶室友或好朋友一起來喝一杯好茶`
      ].join("\n");
    } else {
      captionBody = [
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
      ].join("\n");
    }

    const igCaption = {
      hook: `🌿 ${dir.hook}`,
      body: captionBody,
      eventLogistics: logistics.eventLogistics,
      callToAction: `👉 點擊個人檔案自介連結預約席位，或留言「+1」小編私訊保留限定茶點份量！`,
      hashtags: logistics.hashtags
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

  const sorted = directions;
  const topDirection = sorted[0];

  // 產生敏感發布確認 Token
  const conf = generateConfirmationToken("發布至社群與 Canva 草稿", "publish_social_campaign", {
    platform: "instagram",
    caption: topDirection.igCaption.hook
  });

  const assignedProfile =
    domain === "ntu"
      ? {
          id: "ntu",
          name: "臺大校園脈絡專家",
          role: "NTU Campus Specialist & Creative Orchestrator"
        }
      : domain === "general"
      ? {
          id: "general",
          name: "大專青年脈絡專家",
          role: "Campus Youth Specialist & Creative Orchestrator"
        }
      : {
          id: "tku",
          name: "淡江校園脈絡專家",
          role: "Tamkang Campus Specialist & Creative Orchestrator"
        };

  return {
    query: userQuery,
    executedAt: new Date().toISOString(),
    activeProject: project,
    assignedProfile,
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
    },
    instagramResearch: researchInstagramTrends({ domain, topic: userQuery }),
    research: workflow.research,
    researchAudienceWorkflow: {
      domain: workflow.domain,
      connected: [...workflow.connected],
      method: "ai_heuristic",
      topDirectionId: workflow.topDirection.raw.id,
    },
  };
}
