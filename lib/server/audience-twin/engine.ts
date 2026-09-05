import type { PersonaProfile, AudienceScore, PersonaFeedback, AudienceSimulationResult } from "./types.ts";

export const PERSONAS: PersonaProfile[] = [
  {
    id: "target_freshman",
    name: "大一新生・小涵 (企管系)",
    tag: "核心目標受眾 (Target Audience)",
    role: "淡水通勤大一新生",
    avatar: "🎒",
    perspective: "剛進大學，每天爬克難坡累爆，選課搶不到很焦慮。想認識新朋友但極度害怕尷尬破冰或被社團強迫推銷。",
    mindset: "『如果只是能坐下來喝杯好茶、聽學長姐講講選課不踩雷的經驗，而且完全不用尷尬自我介紹，我會想去。』",
    triggers: ["選課攻略", "克難坡腿酸", "免費冷泡茶", "零社交壓力", "不尷尬", "大腦重開機"],
    dislikes: ["強迫推銷", "人生大道理", "宗教沉重感", "強制上台自我介紹", "長輩圖"]
  },
  {
    id: "bystander",
    name: "冷淡路人・阿倫 (資管二)",
    tag: "滑動旁觀者 (Bystander)",
    role: "IG 重度使用者，平均每則貼文停留 0.8 秒",
    avatar: "📱",
    perspective: "每天被海量社團迎新洗版，任何看起來像公版海報的圖直接大拇指滑走，只有前兩行文字或視覺首圖極具衝擊力才會停下。",
    mindset: "『排版太滿的我根本懶得看，除非標題第一眼就講中我的痛點（比如：到底誰發明克難坡的？）。』",
    triggers: ["視覺留白", "雜誌感排版", "首句好奇鉤子", "幽默反差", "神共鳴梗"],
    dislikes: ["字密密麻麻", "罐頭宣傳詞", "踏上未知的旅程", "探索心靈奧秘", "無聊公告文"]
  },
  {
    id: "skeptic",
    name: "懷疑論者・廷宇 (大二工學院)",
    tag: "嚴格檢驗者 (Skeptic)",
    role: "防禦心理強，排斥宗教洗腦與隱形收費",
    avatar: "🧐",
    perspective: "看到『禪』字第一反應會警惕：『這是不是宗教團體拉人？會不會要繳社費？會不會強迫我吃素念經？』",
    mindset: "『只要行程公開透明、強調科學腹式呼吸專注、不談玄學、明講免費無推銷，我就願意給過。』",
    triggers: ["透明時程表", "標明完全免費", "科學專注呼吸法", "純茶席交流", "無宗教包袱"],
    dislikes: ["改運發大財宣稱", "神秘莫測的詞彙", "行程不透明", "字體長輩風", "過度熱情裝熟"]
  },
  {
    id: "peer_advocate",
    name: "同儕推手・小琪 (大一文學院)",
    tag: "同儕擴散者 (Peer Advocate)",
    role: "愛拉朋友一起參加活動的文青小幫手",
    avatar: "✨",
    perspective: "喜歡有質感、拍照好看、氛圍溫暖的小聚會。常常在 LINE 群揪室友：『欸要不要陪我去這個？看起來好讚！』",
    mindset: "『海報如果有宮燈教室或福園的微光氛圍，茶點看起來很精緻，我一定會把這張截圖丟到大一女宿群組揪人！』",
    triggers: ["精緻手作茶點", "宮燈微光美學", "可以攜伴參加", "手作小禮物", "文青打卡感"],
    dislikes: ["冷冰冰的教條式排版", "壓抑嚴肅的氛圍", "沒點心"]
  },
  {
    id: "creative_director",
    name: "創意總監・V 導 (設計學院)",
    tag: "品質把關者 (Creative Director)",
    role: "視覺美感與敘事架構嚴審員",
    avatar: "🎯",
    perspective: "絕不容許任何低劣 AI-slop、刺眼螢光漸層或規範違規。嚴格檢視手作三色光道具定位與字體呼吸感。",
    mindset: "『三色光必須以手作小印章自然融入，嚴禁變成巨大商標；大標題要一擊命中，不能出現任何空泛廢話。』",
    triggers: ["思源宋體低飽和自然色", "三色光手作圓形道具符合規範", "明確視覺層次", "真實校園情境"],
    dislikes: ["三色光過度放大變標靶", "AI 常用罐頭字 (揭開神秘面紗/不容錯過)", "可讀中文字體溢出破版"]
  }
];

// AI Slop 關鍵字清單（檢測到將大幅扣分）
const SLOP_KEYWORDS = [
  "踏上這趟旅程", "探索心靈奧秘", "揭開神秘面紗", "不容錯過", "在這個快節奏的時代",
  "讓我們一起", "華麗轉身", "共襄盛舉", "期待您的光臨", "一場心靈的盛宴"
];

// 校園真實共鳴詞彙（檢測到將獲得加分）
const CAMPUS_AUTH_KEYWORDS = [
  "克難坡", "福園", "宮燈教室", "黑天鵝", "選課", "紅27", "大一新生", "冷泡茶",
  "大腦重開機", "專注放鬆", "無社交壓力", "不尷尬", "活動中心"
];

/**
 * 受眾雙生模擬計算引擎
 */
export function simulateAudienceReaction(
  conceptTitle: string,
  description: string,
  visualNotes: string,
  copyExcerpt: string = ""
): AudienceSimulationResult {
  const fullText = `${conceptTitle} ${description} ${visualNotes} ${copyExcerpt}`.toLowerCase();

  // 1. 檢測 AI Slop 扣分
  let slopPenalty = 0;
  const slopFound: string[] = [];
  for (const slop of SLOP_KEYWORDS) {
    if (fullText.includes(slop.toLowerCase())) {
      slopPenalty += 12;
      slopFound.push(slop);
    }
  }

  // 2. 檢測校園真實共鳴加分
  let authBonus = 0;
  const authFound: string[] = [];
  for (const kw of CAMPUS_AUTH_KEYWORDS) {
    if (fullText.includes(kw.toLowerCase())) {
      authBonus += 6;
      authFound.push(kw);
    }
  }

  // 3. 基礎分數計算
  const baseScore = Math.min(94, Math.max(50, 78 + authBonus - slopPenalty));

  const scores: AudienceScore = {
    stopIntent: Math.min(98, Math.max(45, baseScore + (fullText.includes("克難坡") || fullText.includes("大腦重開機") ? 8 : -2))),
    relevance: Math.min(96, Math.max(40, baseScore + (fullText.includes("選課") || fullText.includes("大一新生") ? 7 : 0))),
    peerAffinity: Math.min(95, Math.max(40, baseScore + (fullText.includes("茶點") || fullText.includes("宮燈") ? 6 : -4))),
    ctaClarity: Math.min(98, Math.max(50, baseScore + (fullText.includes("免費") && fullText.includes("活動中心") ? 8 : 2))),
    safetyIndex: Math.min(96, Math.max(35, baseScore + (fullText.includes("無社交壓力") || fullText.includes("零推銷") ? 9 : -5))),
    overallScore: 0
  };

  scores.overallScore = Math.round(
    scores.stopIntent * 0.25 +
    scores.relevance * 0.25 +
    scores.peerAffinity * 0.15 +
    scores.ctaClarity * 0.15 +
    scores.safetyIndex * 0.20
  );

  // 4. 生成 5 位 Persona 的擬真評論
  const feedback: PersonaFeedback[] = [
    {
      personaId: "target_freshman",
      name: PERSONAS[0].name,
      avatar: PERSONAS[0].avatar,
      score: Math.min(98, scores.relevance + (authFound.length > 0 ? 3 : -5)),
      reaction: authFound.includes("克難坡") || authFound.includes("選課")
        ? "真的講到我心坎裡！第一週走克難坡真的走到懷疑人生，能坐下來喝茶聊天感覺超棒。"
        : "感覺還不錯，但希望保證不要有奇怪的破冰團康，我真的很怕尷尬。",
      critique: fullText.includes("不尷尬") || fullText.includes("無社交壓力")
        ? "看到『保證不尷尬』我就放心了，會想跟室友一起去看看。"
        : "如果文宣能更明確標註『零社交壓力、純喝茶聊天』，我的心理防備會完全解除。",
      constructiveSuggestion: "建議把茶會『有學長姐分享淡江選課不踩雷攻略』特別標出來，這對大一最實用！"
    },
    {
      personaId: "bystander",
      name: PERSONAS[1].name,
      avatar: PERSONAS[1].avatar,
      score: Math.min(95, scores.stopIntent - (slopFound.length > 0 ? 15 : 0)),
      reaction: slopFound.length > 0
        ? `看到「${slopFound[0]}」這種句子我就想直接滑掉了，太像罐頭官腔宣傳。`
        : "第一眼標題有反差感，排版乾淨，確實能讓我停留多看三秒。",
      critique: "封面主視覺文字一定要大於 40pt，前兩行一定要有痛點鉤子，不要把時間地點塞在正中間。",
      constructiveSuggestion: "首圖放大『大腦重開機』或『克難坡茶席』四個字，時間地點放最下方收尾就好。"
    },
    {
      personaId: "skeptic",
      name: PERSONAS[2].name,
      avatar: PERSONAS[2].avatar,
      score: Math.min(94, scores.safetyIndex - (fullText.includes("探索心靈") ? 10 : 0)),
      reaction: fullText.includes("免費") && (fullText.includes("科學") || fullText.includes("呼吸"))
        ? "有清楚寫出流程是體驗呼吸放鬆與喝茶，且明定完全免費無推銷，合理很多。"
        : "本來擔心會不會是假喝茶真拉人，需要更具體列出當天的流程分鐘數。",
      critique: "務必保留『完全免費・歡迎攜伴・純粹心靈充電』的聲明，能打消多數新生的防備心理。",
      constructiveSuggestion: "明確標註流程：18:30 迎賓茶 -> 19:00 選課分享 -> 19:20 專注放鬆體驗 -> 19:50 茶點時間，透明度 100 分。"
    },
    {
      personaId: "peer_advocate",
      name: PERSONAS[3].name,
      avatar: PERSONAS[3].avatar,
      score: Math.min(97, scores.peerAffinity + 4),
      reaction: "這個風格好有質感！配上冷泡茶和手作茶點的示意，我會想直接轉傳到我們系的大一群組！",
      critique: "可以加一句『歡迎帶室友一起來』，因為大一很少敢單獨赴約，通常是一寢一起出動。",
      constructiveSuggestion: "限動加上『Tag 一位每天爬坡爬到懷疑人生的室友』互動貼紙，轉發率會直接翻倍！"
    },
    {
      personaId: "creative_director",
      name: PERSONAS[4].name,
      avatar: PERSONAS[4].avatar,
      score: Math.min(96, baseScore + (visualNotes.includes("三色光") ? 4 : -2)),
      reaction: visualNotes.includes("手作") || visualNotes.includes("圓形")
        ? "視覺規範把控得很好，手作三色光道具適度收斂在角落，色調具備自然光感與低飽和文青底蘊。"
        : "視覺整體及格，但需嚴格確保三色光不可過度放大或變形。",
      critique: slopFound.length > 0
        ? `文案中出現 AI Slop 字眼（${slopFound.join("、")}），必須立即刪除重構。`
        : "文字節奏舒服，排版留白度高，沒有 AI 罐頭套話的油膩感，值得執行落地。",
      constructiveSuggestion: "主色系維持在深茶綠、米白與陶土褐，字體堅持思源宋體與無襯線體對比。"
    }
  ];

  // 5. 辯論共識與證據/假設拆解
  const consensus: "strongly_recommended" | "recommended" | "needs_iteration" =
    scores.overallScore >= 85 ? "strongly_recommended" : scores.overallScore >= 72 ? "recommended" : "needs_iteration";

  const debateSummary = `5 位模擬受眾對【${conceptTitle}】達成高度共識（綜合得分 ${scores.overallScore}/100）。核心大一受眾小涵給予高度共鳴，肯定真實校園痛點切入；懷疑論者與路人阿倫確認無 AI 罐頭廢話，時程透明安全感足夠。`;

  const evidencePoints = [
    "淡江大學克難坡 132 階為全校新生普遍體能痛點（校園真實記憶）",
    "大一開學前三週選課系統與搶課壓力為學生最強社交破冰話題",
    "福園黑天鵝池與宮燈教室自帶人文寧靜意象，學生好感度高"
  ];

  const hypothesisPoints = [
    "推論大一新生對『無社交壓力茶會』之點擊意願高於傳統說教式迎新約 35%",
    "假設主打『攜伴參加免尷尬』能帶動整寢新生群體赴約率"
  ];

  return {
    conceptTitle,
    scores,
    feedback,
    debateSummary,
    consensus,
    evidencePoints,
    hypothesisPoints
  };
}
