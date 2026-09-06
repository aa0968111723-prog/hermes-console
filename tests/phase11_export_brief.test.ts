import test from "node:test";
import assert from "node:assert/strict";
import {
  getCampusContextInfo,
  generateCreativeStrategyMarkdown,
  getStrategyBriefFilename,
  downloadMarkdownFile,
  downloadJsonBundle
} from "../lib/client/export-brief.ts";
import type { CreativeDirection } from "../lib/server/creative-workflow/pipeline.ts";
import type { ReverseThinkingResult } from "../lib/server/audience-twin/reverse-thinking.ts";
import type { InstagramResearchReport } from "../lib/server/social/instagram-research.ts";

// 測試用之 Direction fixture
const mockDirection: CreativeDirection = {
  id: "dir_test_oasis",
  title: "通識搶課轉圈圈・一席清幽心靈綠洲",
  subtitle: "初入校園・給自己一個按下 Pause 的午後",
  hook: "選課系統轉圈圈心好累？來活大體驗 5 分鐘關掉雜訊的深層呼吸禪。",
  coreInsight: "開學初期搶課焦慮與適應壓力，主打無推銷與學長姐選課避雷指南。",
  visualConcept: "日系簡約風格。冷杉灰綠與霧白底色，角落 36px 手作三色光印章。",
  colorPalette: [
    { name: "冷杉清灰綠", hex: "#4A6357" },
    { name: "極簡月光白", hex: "#FAFAF8" },
    { name: "琥珀茶湯金", hex: "#D4A359" },
    { name: "墨色沉澱黑", hex: "#232B28" }
  ],
  audienceScores: {
    overallScore: 91,
    stopIntent: 89,
    relevance: 94,
    peerAffinity: 88,
    ctaClarity: 92,
    safetyIndex: 95
  },
  audienceFeedback: {
    conceptTitle: "通識搶課轉圈圈・一席清幽心靈綠洲",
    scores: {
      overallScore: 91,
      stopIntent: 89,
      relevance: 94,
      peerAffinity: 88,
      ctaClarity: 92,
      safetyIndex: 95
    },
    consensus: "strongly_recommended",
    debateSummary: "受眾一致認為生活痛點明確，選課切入點大幅消除宗教與推銷戒心。",
    feedback: [
      {
        personaId: "target_freshman",
        name: "大一新生（小涵）",
        avatar: "🎒",
        score: 93,
        reaction: "看到選課轉圈圈完全就是我的心聲！",
        critique: "標題很親切，但希望明確寫出幾點結束。",
        constructiveSuggestion: "加註活動時間 18:30-20:00 與完全免費。"
      },
      {
        personaId: "bystander",
        name: "路過路人（阿傑）",
        avatar: "🚶",
        score: 88,
        reaction: "視覺很清爽，不會像奇怪傳單。",
        critique: "如果文字太多還是會滑掉。",
        constructiveSuggestion: "保持 4:5 滿版簡約留白。"
      }
    ],
    evidencePoints: ["選課加退選首週為大專學生焦慮高峰期"],
    hypothesisPoints: ["茶席能降低社團防衛心理"],
    disclaimer: "本模擬評估依據 AI 啟發式受眾雙生模型生成",
    simulation: true,
    method: "ai_heuristic",
    personaSource: "console_fixture",
    domain: "ntu"
  },
  canvaBlueprint: {
    title: "通識搶課轉圈圈・一席清幽心靈綠洲 - 4:5 宣傳海報",
    dimensions: "1080x1350",
    exportDraftUrl: "https://www.canva.com/design/mock-oasis",
    layers: [
      { layer: 1, type: "background", content: "#FAFAF8 燕麥底色", note: "柔和無壓" },
      { layer: 2, type: "badge", content: "【新生茶會】", note: "頂部安全區" },
      { layer: 3, type: "title", content: "通識搶課轉圈圈", note: "中央主標題" },
      { layer: 4, type: "logistics", content: "每週二 18:30", note: "時間地點" },
      { layer: 5, type: "cta_and_stamp", content: "免費入場 + 36px 手作三色光印章", note: "右下角" }
    ]
  },
  igCaption: {
    hook: "選課系統轉圈圈心好累？",
    body: "面對陌生的校園生活與加退選焦慮，給自己一杯冷泡茶的時間。",
    eventLogistics: "📅 時間：每週二 18:30 - 20:00\\n📍 地點：活大多功能教室",
    callToAction: "點擊簡介連結預約席位，備有精選茶點！",
    hashtags: ["#臺灣大學", "#選課避雷", "#大一新生", "#心靈綠洲"]
  }
};

const mockReverseThinking: ReverseThinkingResult = {
  triggered: true,
  triggers: ["逆向思考", "路人視角"],
  order: ["bystander", "skeptic", "target_freshman", "peer_advocate", "creative_director"],
  perspectives: [
    {
      personaId: "bystander",
      name: "路人視角",
      prompt: "第一眼會不會滑掉？",
      firstGlance: "排版舒服，但第一眼以為是咖啡廳廣告。",
      wouldSwipeAway: false,
      swipeReason: "若沒有選課字眼就會直接滑過。",
      keepReason: "被『選課轉圈圈』打中。",
      revisionAsk: "將選課痛點字級放大 15%。",
      sourceKind: "console_fixture"
    },
    {
      personaId: "skeptic",
      name: "懷疑論者",
      prompt: "會不會覺得在傳教或推銷？",
      firstGlance: "開頭很生活化，但後面會不會推銷點心或收社費？",
      wouldSwipeAway: false,
      swipeReason: "一旦有推銷字眼立刻封鎖。",
      keepReason: "承諾完全免費且零推銷。",
      revisionAsk: "保留『絕不強迫發言』保證。",
      sourceKind: "console_fixture"
    }
  ],
  simulatedEvaluation: mockDirection.audienceFeedback,
  envelope: {
    roles: [],
    note: "AI Heuristic Note",
    simulation: true,
    method: "ai_heuristic",
    disclaimer: "AI Heuristic Disclaimer"
  },
  debate: {
    perspectives: [],
    consensus: ["痛點明確"],
    unresolved: [],
    recommendedDirection: "dir_test_oasis"
  },
  swipeRisk: {
    score: 24,
    label: "low",
    method: "ai_heuristic",
    note: "選課主題貼合新生當務之急，滑掉風險極低。"
  },
  recommendedRevisions: [
    "在 Canva 第 3 圖層進一步突顯『選課避雷』關鍵詞",
    "承諾免費並強調無需自備茶具"
  ],
  simulation: true,
  method: "ai_heuristic",
  personaSource: "console_fixture",
  disclaimer: "AI Heuristic Reverse Thinking"
};

const mockIgReport: InstagramResearchReport = {
  domain: "ntu",
  topic: "臺大迎新茶會",
  dataSource: "campus_trend_engine",
  truthStatus: {
    connected: false,
    status: "unconfigured",
    message: "使用離線校園生活模型"
  },
  hashtags: {
    recommendedSet: ["#臺灣大學", "#選課避雷", "#新生茶會"],
    campusIdentity: [],
    lifestyle: [],
    freshmanHook: [],
    all: []
  },
  optimalPostingTimes: [
    {
      name: "晨間通勤與早八醒腦",
      timeRange: "07:30 - 08:45",
      startHour: 7.5,
      endHour: 8.75,
      studentActivity: "公館捷運站往椰林大道騎單車",
      formatRecommendation: "feed_portrait_4_5",
      reachWeight: 88,
      dwellTimeSec: 8,
      interactionRate: "高",
      isPrimeGoldenHour: false,
      notes: "直式海報最吸睛"
    },
    {
      name: "午後課間與放空充電",
      timeRange: "12:00 - 13:30",
      startHour: 12,
      endHour: 13.5,
      studentActivity: "小福午餐、醉月湖散步",
      formatRecommendation: "feed_portrait_4_5",
      reachWeight: 96,
      dwellTimeSec: 12,
      interactionRate: "最高",
      isPrimeGoldenHour: true,
      notes: "互動轉傳巔峰時段"
    },
    {
      name: "晚間就寢前與深層舒壓",
      timeRange: "21:30 - 23:00",
      startHour: 21.5,
      endHour: 23,
      studentActivity: "宿舍睡前滑手機放空",
      formatRecommendation: "carousel",
      reachWeight: 92,
      dwellTimeSec: 15,
      interactionRate: "極高",
      isPrimeGoldenHour: false,
      notes: "適合沉浸閱讀長文案"
    }
  ],
  currentPostingReadiness: {
    score: 85,
    currentSlot: "午後課間與放空充電",
    advice: "當前為學生用餐放空時段，適合發布！",
    isGoldenHourNow: true
  },
  visualGuidelines: {
    recommendedAspectRatio: "4:5",
    dimensions: { width: 1080, height: 1350 },
    safeZones: { top: 120, bottom: 140 },
    craftStampRule: "右下角 36px 手作三色光道具印章",
    hookFoldLineChars: 45
  },
  disclaimer: "AI Trend Simulation Heuristic"
};

test("Phase 11 Comprehensive Strategy Brief Export Hub", async (t) => {
  await t.test("getCampusContextInfo isolates landmarks correctly per domain", () => {
    const ntuContext = getCampusContextInfo("ntu");
    assert.ok(ntuContext.campusName.includes("臺灣大學"));
    assert.ok(ntuContext.landmarks.some((l) => l.includes("椰林大道")));
    assert.ok(ntuContext.landmarks.some((l) => l.includes("醉月湖")));
    assert.ok(ntuContext.landmarks.some((l) => l.includes("第一學生活動中心")));
    // 嚴格隔離，不得含淡江地標
    assert.ok(!ntuContext.landmarks.some((l) => l.includes("克難坡")));
    assert.ok(!ntuContext.landmarks.some((l) => l.includes("宮燈教室")));

    const tkuContext = getCampusContextInfo("tamkang");
    assert.ok(tkuContext.campusName.includes("淡江大學"));
    assert.ok(tkuContext.landmarks.some((l) => l.includes("克難坡")));
    assert.ok(tkuContext.landmarks.some((l) => l.includes("宮燈長廊")));
    assert.ok(tkuContext.landmarks.some((l) => l.includes("福園黑天鵝")));
    // 嚴格隔離，不得含臺大地標
    assert.ok(!tkuContext.landmarks.some((l) => l.includes("椰林大道")));
    assert.ok(!tkuContext.landmarks.some((l) => l.includes("醉月湖")));

    const genContext = getCampusContextInfo("general");
    assert.ok(genContext.campusName.includes("大專院校"));
    assert.ok(genContext.landmarks.some((l) => l.includes("學生活動中心多功能室")));
    assert.ok(!genContext.landmarks.some((l) => l.includes("克難坡")));
    assert.ok(!genContext.landmarks.some((l) => l.includes("椰林大道")));
  });

  await t.test("getStrategyBriefFilename creates sanitized filename with domain, title and date", () => {
    const filenameMd = getStrategyBriefFilename("通識/搶課*測試?題", "ntu", "md");
    assert.ok(filenameMd.startsWith("hermes_brief_ntu_"));
    assert.ok(filenameMd.endsWith(".md"));
    assert.ok(!filenameMd.includes("/"));
    assert.ok(!filenameMd.includes("*"));
    assert.ok(!filenameMd.includes("?"));

    const filenameJson = getStrategyBriefFilename("淡江茶會", "tamkang", "json");
    assert.ok(filenameJson.startsWith("hermes_brief_tamkang_"));
    assert.ok(filenameJson.endsWith(".json"));
  });

  await t.test("generateCreativeStrategyMarkdown generates complete 7-section brief", () => {
    const md = generateCreativeStrategyMarkdown({
      direction: mockDirection,
      reverseThinking: mockReverseThinking,
      domain: "ntu",
      projectName: "ntu-zen-agent",
      queryPrompt: "臺大新生通識避雷茶會網宣",
      instagramResearch: mockIgReport
    });

    // 檢查標題與基本元資料
    assert.ok(md.includes("# 【Hermes 創意智慧】社群創意策略企劃案與跨平台交付簡報"));
    assert.ok(md.includes("ntu-zen-agent"));
    assert.ok(md.includes("臺灣大學"));

    // 檢查 7 大章節存在
    assert.ok(md.includes("## 一、 創意核心策略與主題定位"));
    assert.ok(md.includes("## 二、 校園地標與在地脈絡深度融合"));
    assert.ok(md.includes("## 三、 Audience Twin 5 大受眾雙生立體畫像與辯論審查"));
    assert.ok(md.includes("## 四、 逆向思考（Reverse Thinking）與路人滑掉風險分析"));
    assert.ok(md.includes("## 五、 Canva 4:5 視覺化草稿藍圖與手作三色光印章規範"));
    assert.ok(md.includes("## 六、 Instagram 社群文案、Hashtags 與 3 大生活發布時段"));
    assert.ok(md.includes("## 七、 誠實整合與 AI 模擬啟發式免責宣告"));

    // 檢查色彩調性與主標
    assert.ok(md.includes("通識搶課轉圈圈・一席清幽心靈綠洲"));
    assert.ok(md.includes("#4A6357"));
    assert.ok(md.includes("冷杉清灰綠"));

    // 檢查校園隔離 (NTU 脈絡不可出現淡江地標)
    assert.ok(md.includes("椰林大道"));
    assert.ok(md.includes("醉月湖"));
    assert.ok(!md.includes("克難坡"));
    assert.ok(!md.includes("宮燈教室"));

    // 檢查受眾評分
    assert.ok(md.includes("91"));
    assert.ok(md.includes("拇指停留率"));
    assert.ok(md.includes("大一新生（小涵）"));

    // 檢查逆向思考與路人滑掉風險
    assert.ok(md.includes("路人滑掉風險評級"));
    assert.ok(md.includes("LOW RISK"));
    assert.ok(md.includes("5 大受眾第一眼直覺與抗性檢驗"));
    assert.ok(md.includes("被『選課轉圈圈』打中"));

    // 檢查 Canva 4:5 規格與 36px 手作三色光印章規範
    assert.ok(md.includes("1080 × 1350 px"));
    assert.ok(md.includes("4:5 直式滿版"));
    assert.ok(md.includes("36px 手作圓形三色光道具邊角印章規範"));
    assert.ok(md.includes("#D64045"));
    assert.ok(md.includes("#E9B44C"));
    assert.ok(md.includes("#4F772D"));
    assert.ok(md.includes("嚴禁"));

    // 檢查 3 大生活發布時段
    assert.ok(md.includes("晨間通勤與早八醒腦"));
    assert.ok(md.includes("午後課間與放空充電"));
    assert.ok(md.includes("晚間就寢前與深層舒壓"));
    assert.ok(md.includes("⭐ **黃金檔期**"));

    // 檢查誠實免責聲明
    assert.ok(md.includes("ai_heuristic"));
    assert.ok(md.includes("console_fixture"));
    assert.ok(md.includes("sandbox_blueprint"));
    assert.ok(md.includes("Security Confirmation Token"));
  });

  await t.test("generateCreativeStrategyMarkdown strictly embeds Tamkang landmarks for tamkang domain", () => {
    const tkuDir: CreativeDirection = {
      ...mockDirection,
      id: "dir_tku_test",
      title: "淡江克難坡後的放鬆茶席"
    };
    const md = generateCreativeStrategyMarkdown({
      direction: tkuDir,
      domain: "tamkang",
      projectName: "tku-zen-agent",
      queryPrompt: "淡江克難坡茶席"
    });

    assert.ok(md.includes("淡江大學"));
    assert.ok(md.includes("克難坡"));
    assert.ok(md.includes("宮燈長廊"));
    assert.ok(!md.includes("椰林大道"));
    assert.ok(!md.includes("醉月湖"));
  });

  await t.test("client-side blob download helpers safely return false in Node runtime without errors", () => {
    const mdResult = downloadMarkdownFile("brief.md", "# Test Content");
    assert.equal(mdResult, false);

    const jsonResult = downloadJsonBundle("bundle.json", { test: 123 });
    assert.equal(jsonResult, false);
  });
});
