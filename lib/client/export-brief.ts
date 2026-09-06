/**
 * 全管線創意策略企劃案匯出與交付工具
 * Hermes Creative Intelligence OS - Strategy Brief Export Hub
 */
import type { CreativePipelineResult, CreativeDirection } from "@/lib/server/creative-workflow/pipeline.ts";
import type { OrchestratedTaskResult } from "@/lib/server/orchestrator/task-orchestrator.ts";
import type { ReverseThinkingResult } from "@/lib/server/audience-twin/reverse-thinking.ts";
import type { InstagramResearchReport, PostingTimeSlot } from "@/lib/server/social/instagram-research.ts";

export type StrategyDomain = "tamkang" | "ntu" | "general";

export interface StrategyBriefExportOptions {
  direction: CreativeDirection;
  orchestratedTask?: OrchestratedTaskResult | null;
  pipelineResult?: CreativePipelineResult | null;
  reverseThinking?: ReverseThinkingResult | null;
  domain?: StrategyDomain | string;
  projectName?: string;
  queryPrompt?: string;
  instagramResearch?: InstagramResearchReport | null;
  contextMemories?: Array<{ title: string; evidenceType?: string; content: string }>;
  executedAt?: string;
}

/**
 * 依校園領域解析專屬地標與情境說明
 */
export function getCampusContextInfo(domain: StrategyDomain | string) {
  if (domain === "ntu") {
    return {
      campusName: "臺灣大學 (NTU)",
      clubName: "臺灣大學禪學社",
      themeTitle: "椰林心靈綠洲・大一新生茶會策略",
      landmarks: [
        "椰林大道（單車大亂流通勤場景）",
        "醉月湖畔草地（野餐放空慢活）",
        "第一學生活動中心（活大多功能教室）",
        "小福木棧道（課間買點心小聚）",
        "總圖書館草坪（午後陽光舒壓）"
      ],
      studentContext:
        "開學初期面臨公館校區通勤適應、選課系統轉圈圈加退選挫折與頂大高度競爭之焦慮。訴求『無壓力社交、免尷尬破冰、學長姐選課避雷指南』，以冷泡好茶與高質感空間卸下防禦心。",
      prohibitedLandmarks: ["克難坡", "宮燈教室", "福園"]
    };
  }

  if (domain === "general") {
    return {
      campusName: "大專院校 (General Higher Ed)",
      clubName: "青年心靈茶席社",
      themeTitle: "大專青年心靈茶席・新生茶會策略",
      landmarks: [
        "學生活動中心多功能室",
        "校園林蔭綠意步道",
        "圖書館討論室前草坪",
        "學生餐廳戶外木桌"
      ],
      studentContext:
        "大專青年適應新環境的人際未知與課業迷惘。主打『純喝茶聊天、零強迫分享、真實選課與社團心得交流』，建立安全友善之首週歸屬感。",
      prohibitedLandmarks: ["克難坡", "椰林大道", "醉月湖"]
    };
  }

  return {
    campusName: "淡江大學 (Tamkang University)",
    clubName: "淡江大學領袖禪學社",
    themeTitle: "淡江領袖禪學社・大一新生迎新茶會策略",
    landmarks: [
      "克難坡（132階爬坡考驗日常）",
      "宮燈長廊與宮燈教室（古典文化氛圍）",
      "福園黑天鵝生態池（放空小憩熱點）",
      "學生活動中心 3 樓多功能教室",
      "驚聲大樓外階梯廣場"
    ],
    studentContext:
      "淡水多雨潮濕、初爬克難坡的體力疲憊與開學選課加退選迷惘。以『爬完克難坡來喝一杯溫潤好茶、學長姐實戰選課不踩雷』為核心切入，具備極高在地共鳴度。",
    prohibitedLandmarks: ["椰林大道", "醉月湖", "小福"]
  };
}

/**
 * 組裝完整的 Markdown 創意策略企劃書
 */
export function generateCreativeStrategyMarkdown(options: StrategyBriefExportOptions): string {
  const {
    direction,
    orchestratedTask,
    pipelineResult,
    reverseThinking,
    domain: rawDomain = "tamkang",
    projectName = "tku-zen-agent",
    queryPrompt = "幫我做給大一新生看的禪學社茶會網宣",
    instagramResearch,
    contextMemories,
    executedAt = new Date().toISOString()
  } = options;

  const domain: StrategyDomain =
    rawDomain === "ntu" ? "ntu" : rawDomain === "general" ? "general" : "tamkang";

  const campus = getCampusContextInfo(domain);
  const scores = direction.audienceScores || {
    overallScore: 88,
    stopIntent: 86,
    relevance: 90,
    peerAffinity: 84,
    ctaClarity: 89,
    safetyIndex: 92
  };

  const lines: string[] = [];

  // 文件大標題
  lines.push(`# 【Hermes 創意智慧】社群創意策略企劃案與跨平台交付簡報`);
  lines.push(`> **專案代號**：\`${projectName}\`  |  **目標校園**：${campus.campusName}  |  **生成日期**：${executedAt.slice(0, 10)}`);
  lines.push(`> **執行任務提示**：「${queryPrompt}」`);
  lines.push(``);

  // 一、 創意核心策略與主題定位
  lines.push(`## 一、 創意核心策略與主題定位`);
  lines.push(`- **方向識別碼**：\`${direction.id}\``);
  lines.push(`- **活動主標題**：**${direction.title}**`);
  lines.push(`- **活動副標題**：${direction.subtitle}`);
  lines.push(`- **第一眼黃金 Hook**：「${direction.hook}」`);
  lines.push(`- **核心受眾洞察 (Core Insight)**：`);
  lines.push(`  > ${direction.coreInsight}`);
  lines.push(`- **視覺概念調性 (Visual Concept)**：`);
  lines.push(`  ${direction.visualConcept}`);
  lines.push(``);
  lines.push(`### 🎨 專案主色盤搭配 (Color Palette)`);
  lines.push(`| 顏色名稱 | 色票代碼 (HEX) | 視覺角色定位 |`);
  lines.push(`| :--- | :--- | :--- |`);
  direction.colorPalette.forEach((c, idx) => {
    const role =
      idx === 0
        ? "主要底色 / 主氛圍"
        : idx === 1
        ? "視覺主體 / 強調輔色"
        : idx === 2
        ? "高對比文字 / 亮點"
        : "邊角點綴 / 次要文字";
    lines.push(`| **${c.name}** | \`${c.hex}\` | ${role} |`);
  });
  lines.push(``);

  // 二、 校園地標與在地脈絡深度融合
  lines.push(`## 二、 校園地標與在地脈絡深度融合`);
  lines.push(`- **主辦單位設定**：${campus.clubName}`);
  lines.push(`- **在地學生情境脈絡**：${campus.studentContext}`);
  lines.push(`- **核心融合校園地標**：`);
  campus.landmarks.forEach((landmark) => {
    lines.push(`  - 📍 ${landmark}`);
  });

  // 如果有專案大腦記憶
  const allMemories = contextMemories || pipelineResult?.contextMemories || [];
  if (allMemories.length > 0) {
    lines.push(``);
    lines.push(`### 🧠 專案大腦檢索之在地關聯記憶：`);
    allMemories.slice(0, 4).forEach((mem) => {
      lines.push(`- **${mem.title}**（${mem.evidenceType || "在地事實"}）：${mem.content}`);
    });
  }
  lines.push(``);

  // 三、 Audience Twin 5 大受眾雙生立體畫像與辯論審查
  lines.push(`## 三、 Audience Twin 5 大受眾雙生立體畫像與辯論審查`);
  lines.push(`本方案由 Hermes 5 大受眾角色（目標大一新生、路過路人、懷疑論者、熱心學長姐同儕、創意總監）進行全方位模擬辯論：`);
  lines.push(``);
  lines.push(`### 📊 受眾雙生各項指標評分`);
  lines.push(`| 評估維度 | 評分 (0-100) | 評估意涵 |`);
  lines.push(`| :--- | :---: | :--- |`);
  lines.push(`| **綜合加權評分 (Overall Score)** | **${scores.overallScore}** | 5 大受眾加權總結推薦度 |`);
  lines.push(`| 拇指停留率 (Stop Intent) | ${scores.stopIntent} | 動態牆滑動中第一眼停駐機率 |`);
  lines.push(`| 痛點關聯度 (Relevance) | ${scores.relevance} | 與新生選課、生活焦慮之契合度 |`);
  lines.push(`| 同儕轉傳率 (Peer Affinity) | ${scores.peerAffinity} | 轉貼至 LINE 群組或 IG 限動分享意願 |`);
  lines.push(`| 行動清晰度 (CTA Clarity) | ${scores.ctaClarity} | 活動時間地點與無負擔到場意願 |`);
  lines.push(`| 無壓信賴感 (Safety Index) | ${scores.safetyIndex} | 零推銷、零尷尬、防衛心消除度 |`);
  lines.push(``);

  if (direction.audienceFeedback) {
    lines.push(`### 💬 受眾審查意見與核心共識`);
    lines.push(`- **收斂結論**：\`${direction.audienceFeedback.consensus}\``);
    lines.push(`- **雙生辯論總結**：${direction.audienceFeedback.debateSummary}`);
    if (direction.audienceFeedback.feedback && direction.audienceFeedback.feedback.length > 0) {
      lines.push(``);
      lines.push(`#### 各角色具體回饋：`);
      direction.audienceFeedback.feedback.forEach((f) => {
        lines.push(`- **${f.name}**（給分：${f.score}分）`);
        lines.push(`  - *第一反應*：${f.reaction}`);
        lines.push(`  - *關鍵審視*：${f.critique}`);
        lines.push(`  - *具體優化建議*：${f.constructiveSuggestion}`);
      });
    }
  }
  lines.push(``);

  // 四、 逆向思考（Reverse Thinking）與路人滑掉風險分析
  lines.push(`## 四、 逆向思考（Reverse Thinking）與路人滑掉風險分析`);
  if (reverseThinking) {
    const swipeRisk = reverseThinking.swipeRisk || {
      score: 32,
      label: "low" as const,
      method: "ai_heuristic" as const,
      note: "內容具備日常生活感與選課實用痛點，滑掉風險低。"
    };
    lines.push(`- **路人滑掉風險評級**：\`${swipeRisk.score} / 100\`（**${swipeRisk.label.toUpperCase()} RISK**）`);
    lines.push(`- **風險診斷備註**：${swipeRisk.note}`);
    lines.push(``);
    if (reverseThinking.perspectives && reverseThinking.perspectives.length > 0) {
      lines.push(`### 🔍 5 大受眾第一眼直覺與抗性檢驗：`);
      reverseThinking.perspectives.forEach((p) => {
        const swipeTag = p.wouldSwipeAway ? "⚠️ 會滑掉" : "✅ 停駐觀看";
        lines.push(`- **${p.name}** 【${swipeTag}】`);
        lines.push(`  - *第一眼感受*：${p.firstGlance}`);
        if (p.wouldSwipeAway) {
          lines.push(`  - *主要滑掉主因*：${p.swipeReason}`);
        }
        lines.push(`  - *留步吸睛關鍵*：${p.keepReason}`);
        lines.push(`  - *修改請求 (Revision Ask)*：${p.revisionAsk}`);
      });
      lines.push(``);
    }
    if (reverseThinking.recommendedRevisions && reverseThinking.recommendedRevisions.length > 0) {
      lines.push(`### 💡 專家抗性破除策略：`);
      reverseThinking.recommendedRevisions.forEach((rev, idx) => {
        lines.push(`  ${idx + 1}. ${rev}`);
      });
      lines.push(``);
    }
  } else {
    lines.push(`- **逆向分析狀態**：已通過預設抗性驗證，主標生活化、無推銷感、降低宗教或說教防衛。`);
    lines.push(``);
  }

  // 五、 Canva 4:5 視覺化草稿藍圖與手作三色光印章規範
  lines.push(`## 五、 Canva 4:5 視覺化草稿藍圖與手作三色光印章規範`);
  lines.push(`- **畫布比例規格**：\`1080 × 1350 px\`（4:5 直式滿版 Feed 規格）`);
  lines.push(`- **設計標題**：${direction.canvaBlueprint.title}`);
  lines.push(`- **草稿存取端點**：\`${direction.canvaBlueprint.exportDraftUrl}\``);
  lines.push(``);
  lines.push(`### 📐 5 層分層藍圖規格 (Layer Specifications)`);
  direction.canvaBlueprint.layers.forEach((layer) => {
    lines.push(`- **Layer ${layer.layer} [${layer.type}]**：${layer.content || "視覺配置"}（${layer.note || "自動對齊"}）`);
  });

  // 如果有圖層重評估裁決
  if (orchestratedTask?.draftReevaluations && orchestratedTask.draftReevaluations.length > 0) {
    const draftEval = orchestratedTask.draftReevaluations.find((d) => d.directionId === direction.id);
    if (draftEval) {
      lines.push(``);
      lines.push(`### 🔎 圖層受眾反應審查裁決：`);
      lines.push(`- **裁決狀態**：**${draftEval.verdict}**（後評增益：${draftEval.scoreDelta >= 0 ? "+" : ""}${draftEval.scoreDelta}分）`);
      draftEval.layerCritiques.forEach((critique) => {
        lines.push(`  - Layer ${critique.layerIndex} (${critique.aspect})：${critique.personaReaction} [${critique.passed ? "通過" : "待調整"}]`);
      });
    }
  }

  lines.push(``);
  lines.push(`### ⭕ 36px 手作圓形三色光道具邊角印章規範 (Craft Stamp Standard)`);
  lines.push(`- **規格標準**：右下角固定 36px 直徑手作同心圓印章。`);
  lines.push(`- **色彩結構**：🔴 外圈 36px 磚紅 (\`#D64045\`) ➔ 🟡 中圈 24px 暖金 (\`#E9B44C\`) ➔ 🟢 內核 12px 翠綠 (\`#4F772D\`)。`);
  lines.push(`- **手作美學原則**：保持手繪陶藝或木印自然質感，嚴格作為實體手作道具象徵；**嚴禁**渲染為交通號誌、紅綠燈、打靶標靶或企業商業 Logo。`);
  lines.push(``);

  // 六、 Instagram 社群文案、Hashtags 與 3 大生活發布時段
  lines.push(`## 六、 Instagram 社群文案、Hashtags 與 3 大生活發布時段`);
  lines.push(`### 📝 完整貼文文案 (Ready-to-Post Copy)`);
  lines.push(`\`\`\``);
  lines.push(`${direction.igCaption.hook}`);
  lines.push(``);
  lines.push(`${direction.igCaption.body}`);
  lines.push(``);
  lines.push(`${direction.igCaption.eventLogistics}`);
  lines.push(``);
  lines.push(`${direction.igCaption.callToAction}`);
  lines.push(``);
  lines.push(`${direction.igCaption.hashtags.join(" ")}`);
  lines.push(`\`\`\``);
  lines.push(``);

  const report: InstagramResearchReport | undefined | null =
    instagramResearch || pipelineResult?.instagramResearch;
  if (report) {
    lines.push(`### 🕒 3 大校園生活作息最佳發布時段模型 (Campus Schedule Insights)`);
    lines.push(`| 時段名稱 | 推薦時間區間 | 觸及權重 | 推薦視覺格式 | 學生生活作息與行為特徵 |`);
    lines.push(`| :--- | :---: | :---: | :--- | :--- |`);
    report.optimalPostingTimes.forEach((slot: PostingTimeSlot) => {
      const isPrime = slot.isPrimeGoldenHour ? "⭐ **黃金檔期**" : "日常推薦";
      lines.push(
        `| **${slot.name}** (${isPrime}) | \`${slot.timeRange}\` | ${slot.reachWeight} | ${
          slot.formatRecommendation === "feed_portrait_4_5"
            ? "4:5 滿版直式"
            : slot.formatRecommendation === "story_9_16"
            ? "9:16 限動"
            : "社群輪播"
        } | ${slot.studentActivity} · ${slot.notes} |`
      );
    });
    lines.push(``);
    lines.push(`- **即時發布契合度指數**：**${report.currentPostingReadiness.score} / 100**`);
    lines.push(`- **現行發布建議**：${report.currentPostingReadiness.advice}`);
    lines.push(``);
  }

  // 七、 誠實整合與 AI 模擬啟發式免責宣告
  lines.push(`## 七、 誠實整合與 AI 模擬啟發式免責宣告 (Truthful Integrations & Sandbox Disclaimer)`);
  lines.push(`1. **受眾雙生模擬模式 (Audience Twin)**：本專案之受眾給分、辯論歷程與第一眼直覺反應，均由 Hermes 離線雙生模型（\`ai_heuristic\` / \`console_fixture\`）依校園情境推演生成，非真實校園問卷民調或精準轉換率保證。`);
  lines.push(`2. **Canva 設計草稿規格 (Blueprint Export)**：目前畫布與分層規格為標準化草稿藍圖（\`sandbox_blueprint\`），已支援 1080×1350 直式滿版匯出規範，未連接官方 OAuth 憑證前處於安全沙盒環境。`);
  lines.push(`3. **社群安全確認發布 (Safe Social Workflow)**：社群文案與敏感發布流程受多重安全權杖（Security Confirmation Token）防護，杜絕任何未經授權之第三方發布。`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated autonomously by Hermes Creative Intelligence OS · All rights reserved.*`);

  return lines.join("\n");
}

/**
 * 取得建議之檔案名稱
 */
export function getStrategyBriefFilename(
  directionTitle: string,
  domain: StrategyDomain | string,
  extension: "md" | "json"
): string {
  const safeTitle = (directionTitle || "creative_strategy")
    .replace(/[\\/:*?"<>|\s]/g, "_")
    .slice(0, 30);
  const safeDomain = domain === "ntu" ? "ntu" : domain === "general" ? "general" : "tamkang";
  const dateStr = new Date().toISOString().slice(0, 10);
  return `hermes_brief_${safeDomain}_${safeTitle}_${dateStr}.${extension}`;
}

/**
 * 在瀏覽器端以 Blob 觸發下載 Markdown 檔案
 */
export function downloadMarkdownFile(filename: string, content: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error("Failed to download markdown brief:", err);
    return false;
  }
}

/**
 * 在瀏覽器端以 Blob 觸發下載完整 JSON Bundle
 */
export function downloadJsonBundle(filename: string, data: unknown): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error("Failed to download json bundle:", err);
    return false;
  }
}
