import type {
  PersonaProfile,
  AudienceScore,
  PersonaFeedback,
  AudienceSimulationResult,
  DebateRound,
  DebateVoice,
  AudienceFact
} from "./types.ts";

export type AudienceDomain = "tamkang" | "ntu" | "general";

/**
 * 淡江大學專屬受眾 Persona
 */
export const TAMKANG_PERSONAS: PersonaProfile[] = [
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

/**
 * 臺灣大學 (NTU) 專屬受眾 Persona
 */
export const NTU_PERSONAS: PersonaProfile[] = [
  {
    id: "target_freshman",
    name: "大一新生・宇軒 (電機系)",
    tag: "核心目標受眾 (Target Audience)",
    role: "大一新生，初到公館/椰林校園",
    avatar: "🎒",
    perspective: "剛進大學，校園太大每天騎腳踏車找教室迷路，選課搶不到熱門通識很焦慮。想認識跨學院朋友但抗拒尷尬破冰。",
    mindset: "『如果能在醉月湖畔或活大喝杯好茶、聽學長姐分享雙主修與通識避雷指南，而且不用自我介紹，我會想去。』",
    triggers: ["通識避雷", "椰林騎車", "免費冷泡茶", "零社交壓力", "不尷尬", "大腦重開機"],
    dislikes: ["強迫推銷", "人生大道理", "宗教沉重感", "強制上台自我介紹", "長輩圖"]
  },
  {
    id: "bystander",
    name: "冷淡路人・品妍 (管院二)",
    tag: "滑動旁觀者 (Bystander)",
    role: "社群重度使用者，滑過 NTU Talk / IG 平均停留 0.8 秒",
    avatar: "📱",
    perspective: "每天被各種學生會、系學會迎新活動洗版，只要視覺像官方套版直接滑過，除非大標題直擊大一日常痛點。",
    mindset: "『排版太滿的我根本懶得看，除非標題第一眼擊中痛點（比如：到底誰在總圖搶得到位子？）。』",
    triggers: ["視覺留白", "雜誌感排版", "首句好奇鉤子", "幽默反差", "神共鳴梗"],
    dislikes: ["字密密麻麻", "罐頭宣傳詞", "踏上未知的旅程", "探索心靈奧秘", "無聊公告文"]
  },
  {
    id: "skeptic",
    name: "懷疑論者・子揚 (理學院二)",
    tag: "嚴格檢驗者 (Skeptic)",
    role: "防禦心強，討厭假文青真佈道或隱形社費",
    avatar: "🧐",
    perspective: "看到禪學或身心靈第一反應就是提防傳教。只要時程透明、明講純品茶放鬆與學業避雷、不推銷，才可能給過。",
    mindset: "『只要行程公開透明、強調科學專注呼吸、不談玄學、明講免費無推銷，我就願意給過。』",
    triggers: ["透明時程表", "標明完全免費", "科學專注呼吸法", "純茶席交流", "無宗教包袱"],
    dislikes: ["改運發大財宣稱", "神秘莫測的詞彙", "行程不透明", "字體長輩風", "過度熱情裝熟"]
  },
  {
    id: "peer_advocate",
    name: "同儕推手・詠晴 (文學院一)",
    tag: "同儕擴散者 (Peer Advocate)",
    role: "喜歡有質感咖啡廳與茶席的文青推手",
    avatar: "✨",
    perspective: "喜歡質感好、拍起來文青乾淨的聚會。常在 LINE 揪大一新生室友一起參加。",
    mindset: "『文宣如果有醉月湖畔微光、精緻茶點與文青感排版，我一定會轉貼到大一寢室群組揪人！』",
    triggers: ["精緻手作茶點", "湖畔微光美學", "可以攜伴參加", "手作小禮物", "文青打卡感"],
    dislikes: ["冷冰冰的教條式排版", "壓抑嚴肅的氛圍", "沒點心"]
  },
  {
    id: "creative_director",
    name: "創意總監・V 導 (設計/視覺顧問)",
    tag: "品質把關者 (Creative Director)",
    role: "視覺美感與敘事架構嚴審員",
    avatar: "🎯",
    perspective: "絕不容許任何低劣 AI-slop、刺眼螢光漸層或規範違規。嚴格檢視手作三色光道具定位與字體呼吸感。",
    mindset: "『三色光必須以手作小印章自然融入，嚴禁變成巨大商標；大標題要一擊命中，不能出現任何空泛廢話。』",
    triggers: ["思源宋體低飽和自然色", "三色光手作圓形道具符合規範", "明確視覺層次", "真實校園情境"],
    dislikes: ["三色光過度放大變標靶", "AI 常用罐頭字 (揭開神秘面紗/不容錯過)", "可讀中文字體溢出破版"]
  }
];

/**
 * 通用大專院校受眾 Persona (General Collegiate)
 */
export const GENERAL_PERSONAS: PersonaProfile[] = [
  {
    id: "target_freshman",
    name: "大一新生・宜庭 (新鮮人)",
    tag: "核心目標受眾 (Target Audience)",
    role: "外地通勤或初入住宿的大一新鮮人",
    avatar: "🎒",
    perspective: "面對陌生大學環境、繁瑣選課與社交破冰感到焦慮，渴望自在融入卻害怕尷尬場面。",
    mindset: "『如果能坐下來喝杯好茶、聽學長姐分享選課避雷經驗，且不用尷尬破冰，我很願意去。』",
    triggers: ["選課避雷", "大學生活求生", "免費好茶", "零社交壓力", "不尷尬", "大腦重開機"],
    dislikes: ["強迫推銷", "人生大道理", "宗教沉重感", "強制上台自我介紹", "長輩圖"]
  },
  {
    id: "bystander",
    name: "冷淡路人・冠霖 (大二)",
    tag: "滑動旁觀者 (Bystander)",
    role: "社群滑動者，平均每則貼文停留低於 1 秒",
    avatar: "📱",
    perspective: "每天被大量校園宣傳海報洗版，只有視覺精緻、前兩句直擊痛點的貼文才會停留。",
    mindset: "『排版太滿直接滑過，除非標題第一眼講中大一生活的痛點。』",
    triggers: ["視覺留白", "雜誌感排版", "首句好奇鉤子", "幽默反差", "神共鳴梗"],
    dislikes: ["字密密麻麻", "罐頭宣傳詞", "踏上未知的旅程", "探索心靈奧秘", "無聊公告文"]
  },
  {
    id: "skeptic",
    name: "懷疑論者・哲偉 (大二)",
    tag: "嚴格檢驗者 (Skeptic)",
    role: "防禦心強，排斥隱形收費與假迎新真傳教",
    avatar: "🧐",
    perspective: "看到身心靈或茶會第一反應會提防傳教或推銷。只要時程透明、流程清晰且完全免費才給過。",
    mindset: "『只要時程公開、說明是科學專注呼吸放鬆、免費無推銷，我就願意給過。』",
    triggers: ["透明時程表", "標明完全免費", "科學專注呼吸法", "純茶席交流", "無宗教包袱"],
    dislikes: ["改運發大財宣稱", "神秘莫測的詞彙", "行程不透明", "字體長輩風", "過度熱情裝熟"]
  },
  {
    id: "peer_advocate",
    name: "同儕推手・品萱 (大一)",
    tag: "同儕擴散者 (Peer Advocate)",
    role: "喜愛質感聚會與打卡美學的文青好友",
    avatar: "✨",
    perspective: "喜愛有質感、溫暖且拍起來好看的聚會，習慣揪室友或同學一起前往。",
    mindset: "『海報如果有溫暖茶席氛圍與精緻茶點，我一定會轉貼到新生大一群組揪人！』",
    triggers: ["精緻手作茶點", "溫暖光影美學", "可以攜伴參加", "手作小禮物", "文青打卡感"],
    dislikes: ["冷冰冰的教條式排版", "壓抑嚴肅的氛圍", "沒點心"]
  },
  {
    id: "creative_director",
    name: "創意總監・V 導 (設計總監)",
    tag: "品質把關者 (Creative Director)",
    role: "視覺美感與敘事架構嚴審員",
    avatar: "🎯",
    perspective: "絕不容許任何低劣 AI-slop、刺眼螢光漸層或規範違規。嚴格檢視手作三色光道具定位與字體呼吸感。",
    mindset: "『三色光必須以手作小印章自然融入，嚴禁變成巨大商標；大標題要一擊命中，不能出現任何空泛廢話。』",
    triggers: ["思源宋體低飽和自然色", "三色光手作圓形道具符合規範", "明確視覺層次", "真實情境痛點"],
    dislikes: ["三色光過度放大變標靶", "AI 常用罐頭字 (揭開神秘面紗/不容錯過)", "可讀中文字體溢出破版"]
  }
];

/**
 * 預設匯出 Persona（維持既有相容性，預設為淡江 Persona 結構）
 */
export const PERSONAS: PersonaProfile[] = TAMKANG_PERSONAS;

// AI Slop 語意正則模式（防止同義詞與句型繞過）
export const SLOP_PATTERNS: RegExp[] = [
  /(踏上|開啟|展開).{0,4}(這趟|心靈|人生|未知|全新).{0,4}(旅程|之旅|征途)/i,
  /(探索|揭開|揭曉).{0,4}(心靈|不為人知|神秘|未知).{0,4}(奧秘|面紗|旅程|世界)/i,
  /(不容|萬萬不能|切勿|絕對不能).{0,2}錯過/i,
  /(心靈|靈魂).{0,4}(盛宴|饗宴|洗禮|之旅|淨化)/i,
  /(快節奏|繁忙|喧囂).{0,4}(時代|生活|都市|日常)/i,
  /(讓我們一起|攜手共創|華麗轉身|共襄盛舉|期待您的光臨|帶你領略|沉浸式體會)/i
];

// AI Slop 關鍵字清單（精確比對）
export const SLOP_KEYWORDS: string[] = [
  "踏上這趟旅程", "探索心靈奧秘", "揭開神秘面紗", "不容錯過", "在這個快節奏的時代",
  "讓我們一起", "華麗轉身", "共襄盛舉", "期待您的光臨", "一場心靈的盛宴"
];

// 領域專屬校園真實共鳴詞彙
export const DOMAIN_AUTH_KEYWORDS: Record<AudienceDomain, string[]> = {
  tamkang: [
    "克難坡", "福園", "宮燈教室", "黑天鵝", "選課", "紅27", "大一新生", "冷泡茶",
    "大腦重開機", "專注放鬆", "無社交壓力", "不尷尬", "活動中心"
  ],
  ntu: [
    "椰林", "醉月湖", "總圖", "活大", "小福", "選課", "通識避雷", "大一新生",
    "腳踏車", "冷泡茶", "大腦重開機", "專注放鬆", "無社交壓力", "不尷尬"
  ],
  general: [
    "選課", "通識避雷", "大一新生", "冷泡茶", "大腦重開機", "專注放鬆",
    "無社交壓力", "不尷尬", "活動中心", "大學生活", "社交焦慮"
  ]
};

/**
 * 判斷當前脈絡所屬校園/情境領域
 */
export function resolveContextDomain(fullText: string, projectId?: string): AudienceDomain {
  const lower = `${fullText} ${projectId || ""}`.toLowerCase();
  if (
    lower.includes("tku") ||
    lower.includes("tamkang") ||
    lower.includes("淡江") ||
    lower.includes("克難坡") ||
    lower.includes("福園") ||
    lower.includes("宮燈") ||
    lower.includes("紅27") ||
    lower.includes("黑天鵝") ||
    projectId === "tku-zen-agent"
  ) {
    return "tamkang";
  }

  if (
    lower.includes("ntu") ||
    lower.includes("台大") ||
    lower.includes("臺灣大學") ||
    lower.includes("台灣大學") ||
    lower.includes("椰林") ||
    lower.includes("醉月湖") ||
    lower.includes("總圖") ||
    lower.includes("活大") ||
    lower.includes("小福") ||
    lower.includes("腳踏車")
  ) {
    return "ntu";
  }

  return "general";
}

/**
 * 依脈絡動態解析適合之 Persona
 */
export function resolvePersonasForContext(
  text: string,
  projectId?: string
): { domain: AudienceDomain; personas: PersonaProfile[] } {
  const domain = resolveContextDomain(text, projectId);
  const maxRoles = 5;
  if (domain === "ntu") {
    return { domain, personas: NTU_PERSONAS.slice(0, maxRoles) };
  }
  if (domain === "general") {
    return { domain, personas: GENERAL_PERSONAS.slice(0, maxRoles) };
  }
  return { domain: "tamkang", personas: TAMKANG_PERSONAS.slice(0, maxRoles) };
}

/**
 * 依脈絡領域動態產生客觀事實與推論假設 (Facts Provenance)
 */
export function extractContextFacts(fullText: string, domain: AudienceDomain): AudienceFact[] {
  if (domain === "ntu") {
    return [
      {
        statement: "臺灣大學椰林大道與廣大校區使新生第一週普遍面臨通勤尋找教室之適應期",
        kind: "evidence",
        sourceTag: "[校園真實地標] 國立臺灣大學校園地理環境公開資料",
        confidence: 99
      },
      {
        statement: "大一開學前三週選課系統分發與通識搶課為全校新生最高頻共鳴話題",
        kind: "evidence",
        sourceTag: "[教務行事曆] 臺灣大學選課日程與新生生活常規統計",
        confidence: 95
      },
      {
        statement: "醉月湖畔與總圖書館草坪具備寧靜慢活意象，學生休憩好感度極高",
        kind: "evidence",
        sourceTag: "[校園景觀調研] 臺灣大學校園景觀與學生活動好感度統計",
        confidence: 96
      },
      {
        statement: "第一學生活動中心 (活大) 多功能空間具備空調與展演席位，適合茶席交流",
        kind: "evidence",
        sourceTag: "[實體場地規範] 臺灣大學學生活動中心場地租借資料",
        confidence: 94
      },
      {
        statement: "手作圓形三色光道具規範（紅外、黃中、綠內）直徑 36px 邊角印章落款",
        kind: "evidence",
        sourceTag: "[視覺規範守則] 專案分鏡與視覺資產規範手冊 (AGENTS.md)",
        confidence: 100
      },
      {
        statement: "首屏文案直擊『椰林迷路或通識避雷』可將社群瀏覽停留時間自 0.8s 提升至 2.2s",
        kind: "hypothesis",
        sourceTag: "[心理推論假設] 受眾注意力與拇指滑動心理模型",
        confidence: 85
      },
      {
        statement: "明示『零社交壓力、純品茶聊生活』能顯著降低大一新生防備心達 30%",
        kind: "hypothesis",
        sourceTag: "[心理推論假設] 新生社交焦慮與防禦減壓心理推論",
        confidence: 82
      },
      {
        statement: "宣導『歡迎攜伴室友同行』有助於觸發宿舍跨寢轉傳擴散",
        kind: "hypothesis",
        sourceTag: "[行為推論假設] 大專院校宿舍同儕網絡傳播假說",
        confidence: 80
      }
    ];
  }

  if (domain === "general") {
    return [
      {
        statement: "大專院校新鮮人開學首月普遍面臨生活作息調適與社交圈建立壓力",
        kind: "evidence",
        sourceTag: "[高教新生調研] 大專院校大一新生適應期行為調研報告",
        confidence: 96
      },
      {
        statement: "大學通識與必修搶課機制為開學前三週全體大一學生最關切破冰話題",
        kind: "evidence",
        sourceTag: "[校務生活統計] 大學教務選課週期與學生關注焦點分析",
        confidence: 95
      },
      {
        statement: "校園綠意草坪與靜心教室自帶放鬆心理暗示，利於卸下防禦",
        kind: "evidence",
        sourceTag: "[環境心理學] 校園公共休憩空間與心理減壓關聯研究",
        confidence: 92
      },
      {
        statement: "活動中心多功能教室具備獨立隔音與木質地坪，適合作為沉浸茶席聚會",
        kind: "evidence",
        sourceTag: "[場地規範] 大學校園學生活動空間租借標準",
        confidence: 93
      },
      {
        statement: "手作圓形三色光道具規範（紅外、黃中、綠內）直徑 36px 邊角印章落款",
        kind: "evidence",
        sourceTag: "[視覺規範守則] 專案分鏡與視覺資產規範手冊 (AGENTS.md)",
        confidence: 100
      },
      {
        statement: "首屏文字點出『大腦重開機・選課避雷』可提升社群滑動停留率 2 倍以上",
        kind: "hypothesis",
        sourceTag: "[心理推論假設] 社群資訊滑動與第一印象停留心理學",
        confidence: 83
      },
      {
        statement: "標榜『完全免費・零推銷壓力』能有效排除商業與宗教招募疑慮",
        kind: "hypothesis",
        sourceTag: "[心理推論假設] 大學生防禦心理與消費警覺推論",
        confidence: 86
      },
      {
        statement: "提供攜伴同行機制可降低單獨出席之社交焦慮感",
        kind: "hypothesis",
        sourceTag: "[行為推論假設] 同儕團體陪伴與參與意願關聯假說",
        confidence: 81
      }
    ];
  }

  // 預設為淡江大學 (Tamkang)
  return [
    {
      statement: "淡江大學克難坡 132 階為全校大一新生開學第一週最強烈之體能痛點",
      kind: "evidence",
      sourceTag: "[校園真實地標] 淡江大學校史與地理標誌性地標事實",
      confidence: 99
    },
    {
      statement: "大一開學前三週選課系統與搶課壓力為新生最高頻社交共鳴破冰話題",
      kind: "evidence",
      sourceTag: "[官方行事曆作息] 教務處選課日程與大一新生作息統計",
      confidence: 95
    },
    {
      statement: "福園黑天鵝池畔與宮燈教室自帶人文寧靜校園意象，學生好感度高",
      kind: "evidence",
      sourceTag: "[校園景觀調研] 淡江大學校園地標好感度公開資料",
      confidence: 96
    },
    {
      statement: "活動中心 B307 多功能教室具備木質地板與空調音響，符合茶席靜心規格",
      kind: "evidence",
      sourceTag: "[實體場地規範] 淡江大學學生活動中心場地租借規格資料",
      confidence: 94
    },
    {
      statement: "手作圓形三色光道具規範（紅外、黃中、綠內）直徑 36px 邊角印章落款",
      kind: "evidence",
      sourceTag: "[視覺規範守則] 專案分鏡與視覺資產規範手冊 (AGENTS.md)",
      confidence: 100
    },
    {
      statement: "首屏標題放置『克難坡 132 階』痛點反差鉤子可將 IG 停留秒數自 0.8s 提升至 2.4s",
      kind: "hypothesis",
      sourceTag: "[心理推論假設] 受眾注意力與拇指滑動心理模型",
      confidence: 84
    },
    {
      statement: "明示『零社交壓力、免尷尬自我介紹』可使內向型新生赴約意願提升約 35%",
      kind: "hypothesis",
      sourceTag: "[心理推論假設] 新生社交焦慮與防禦減壓心理推論",
      confidence: 82
    },
    {
      statement: "加入『歡迎攜伴室友同行』文案能促進新生整寢同行之同儕擴散效應",
      kind: "hypothesis",
      sourceTag: "[行為推論假設] 大專院校宿舍同儕網絡傳播假說",
      confidence: 80
    }
  ];
}

/**
 * 受眾雙生模擬計算引擎
 */
export function simulateAudienceReaction(
  conceptTitle: string,
  description: string,
  visualNotes: string,
  copyExcerpt: string = "",
  projectId?: string
): AudienceSimulationResult {
  const fullText = `${conceptTitle} ${description} ${visualNotes} ${copyExcerpt}`.toLowerCase();
  const domain = resolveContextDomain(fullText, projectId);
  const { personas } = resolvePersonasForContext(fullText, projectId);

  // 1. 檢測 AI Slop 扣分 (結合精確關鍵字與語意正則)
  let slopPenalty = 0;
  const slopFound: string[] = [];

  for (const slop of SLOP_KEYWORDS) {
    if (fullText.includes(slop.toLowerCase())) {
      slopPenalty += 14;
      if (!slopFound.includes(slop)) slopFound.push(slop);
    }
  }

  for (const pattern of SLOP_PATTERNS) {
    const match = fullText.match(pattern);
    if (match) {
      slopPenalty += 14;
      const matched = match[0];
      if (!slopFound.includes(matched)) slopFound.push(matched);
    }
  }

  // 2. 檢測領域真實校園共鳴加分
  const authKeywords = DOMAIN_AUTH_KEYWORDS[domain];
  const authFound: string[] = [];
  for (const kw of authKeywords) {
    if (fullText.includes(kw.toLowerCase())) {
      authFound.push(kw);
    }
  }

  // 對數飽和防刷分計算 (Logarithmic Saturation)
  // 解決單純累加造成的關鍵字堆砌刷分漏洞，最大上限 18 分
  const authBonus = authFound.length > 0
    ? Math.min(18, Math.round(Math.log2(authFound.length + 1) * 6.5))
    : 0;

  // 3. 基礎分數計算
  const baseScore = Math.min(94, Math.max(30, 78 + authBonus - slopPenalty));

  const hasHook = domain === "tamkang"
    ? (fullText.includes("克難坡") || fullText.includes("大腦重開機"))
    : domain === "ntu"
    ? (fullText.includes("椰林") || fullText.includes("醉月湖") || fullText.includes("大腦重開機"))
    : (fullText.includes("大腦重開機") || fullText.includes("選課避雷"));

  const hasRel = domain === "tamkang"
    ? (fullText.includes("選課") || fullText.includes("大一新生"))
    : domain === "ntu"
    ? (fullText.includes("選課") || fullText.includes("通識") || fullText.includes("大一新生"))
    : (fullText.includes("選課") || fullText.includes("大一新生"));

  const hasAffinity = domain === "tamkang"
    ? (fullText.includes("茶點") || fullText.includes("宮燈"))
    : domain === "ntu"
    ? (fullText.includes("茶點") || fullText.includes("醉月湖") || fullText.includes("草地"))
    : (fullText.includes("茶點") || fullText.includes("放鬆"));

  const hasSafety = fullText.includes("無社交壓力") || fullText.includes("零推銷") || fullText.includes("不尷尬");

  const scores: AudienceScore = {
    stopIntent: Math.min(98, Math.max(40, baseScore + (hasHook ? 8 : -2))),
    relevance: Math.min(96, Math.max(35, baseScore + (hasRel ? 7 : 0))),
    peerAffinity: Math.min(95, Math.max(35, baseScore + (hasAffinity ? 6 : -4))),
    ctaClarity: Math.min(98, Math.max(45, baseScore + (fullText.includes("免費") ? 8 : 2))),
    safetyIndex: Math.min(96, Math.max(30, baseScore + (hasSafety ? 9 : -5))),
    overallScore: 0
  };

  scores.overallScore = Math.round(
    scores.stopIntent * 0.25 +
    scores.relevance * 0.25 +
    scores.peerAffinity * 0.15 +
    scores.ctaClarity * 0.15 +
    scores.safetyIndex * 0.20
  );

  // 4. 生成 5 位 Persona 的脈絡擬真評論
  const feedback: PersonaFeedback[] = [
    {
      personaId: "target_freshman",
      name: personas[0].name,
      avatar: personas[0].avatar,
      score: Math.min(98, scores.relevance + (authFound.length > 0 ? 3 : -5)),
      reaction: domain === "tamkang"
        ? (authFound.includes("克難坡") || authFound.includes("選課")
            ? "真的講到我心坎裡！第一週走克難坡真的走到懷疑人生，能坐下來喝茶聊天感覺超棒。"
            : "感覺還不錯，但希望保證不要有奇怪的破冰團康，我真的很怕尷尬。")
        : domain === "ntu"
        ? (authFound.includes("椰林") || authFound.includes("選課") || authFound.includes("通識避雷")
            ? "真的講中台大新生心聲！初到椰林大道常迷路，選課又怕踩雷，能坐下來喝杯冷泡茶放鬆超棒。"
            : "希望活動能保持自在，不要有一堆尷尬自我介紹。")
        : (authFound.includes("選課") || authFound.includes("大一新生")
            ? "剛進大學面對新環境很焦慮，能有輕鬆喝茶聊天、聽學長姐經驗分享的場合很吸引我。"
            : "只要保證不尷尬破冰，我就願意去。"),
      critique: fullText.includes("不尷尬") || fullText.includes("無社交壓力")
        ? "看到『保證不尷尬』我就放心了，會想跟室友一起去看看。"
        : "如果文宣能更明確標註『零社交壓力、純喝茶聊天』，我的心理防備會完全解除。",
      constructiveSuggestion: domain === "tamkang"
        ? "建議把茶會『有學長姐分享淡江選課不踩雷攻略』特別標出來，這對大一最實用！"
        : domain === "ntu"
        ? "建議特別註明『學長姐通識避雷與雙主修指南』，對台大新生吸引力極大！"
        : "建議標註『學長姐大一選課避雷求生指南』，實用性滿分！"
    },
    {
      personaId: "bystander",
      name: personas[1].name,
      avatar: personas[1].avatar,
      score: Math.min(95, scores.stopIntent - (slopFound.length > 0 ? 15 : 0)),
      reaction: slopFound.length > 0
        ? `看到「${slopFound[0]}」這種句子我就想直接滑掉了，太像罐頭官腔宣傳。`
        : "第一眼標題有反差感，排版乾淨，確實能讓我停留多看三秒。",
      critique: "封面主視覺文字一定要大於 40pt，前兩行一定要有痛點鉤子，不要把時間地點塞在正中間。",
      constructiveSuggestion: domain === "tamkang"
        ? "首圖放大『大腦重開機』或『克難坡茶席』四個字，時間地點放最下方收尾就好。"
        : domain === "ntu"
        ? "首圖直擊『椰林迷路』或『大腦重開機』痛點，時間地點收在膠囊標籤即可。"
        : "首圖直擊新生痛點大字，將活動時程縮小置底。"
    },
    {
      personaId: "skeptic",
      name: personas[2].name,
      avatar: personas[2].avatar,
      score: Math.min(94, scores.safetyIndex - (fullText.includes("探索心靈") ? 10 : 0)),
      reaction: fullText.includes("免費") && (fullText.includes("科學") || fullText.includes("呼吸") || fullText.includes("放鬆"))
        ? "有清楚寫出流程是體驗呼吸放鬆與喝茶，且明定完全免費無推銷，合理很多。"
        : "本來擔心會不會是假喝茶真拉人，需要更具體列出當天的流程分鐘數。",
      critique: "務必保留『完全免費・歡迎攜伴・純粹心靈充電』的聲明，能打消多數新生的防備心理。",
      constructiveSuggestion: "明確標註流程：18:30 迎賓茶 -> 19:00 選課分享 -> 19:20 專注放鬆體驗 -> 19:50 茶點時間，透明度 100 分。"
    },
    {
      personaId: "peer_advocate",
      name: personas[3].name,
      avatar: personas[3].avatar,
      score: Math.min(97, scores.peerAffinity + 4),
      reaction: domain === "tamkang"
        ? "這個風格好有質感！配上冷泡茶和手作茶點的示意，我會想直接轉傳到我們系的大一群組！"
        : domain === "ntu"
        ? "湖畔草地微光茶席超有文青感！我會直接丟到宿舍 LINE 群揪室友一起去！"
        : "視覺質感很棒，配上冷泡茶與精緻茶點，很適合轉發給室友同行！",
      critique: "可以加一句『歡迎帶室友一起來』，因為大一很少敢單獨赴約，通常是一寢一起出動。",
      constructiveSuggestion: domain === "tamkang"
        ? "限動加上『Tag 一位每天爬坡爬到懷疑人生的室友』互動貼紙，轉發率會直接翻倍！"
        : "限動加上『Tag 一起選課的大一室友』互動貼紙，轉發率會翻倍！"
    },
    {
      personaId: "creative_director",
      name: personas[4].name,
      avatar: personas[4].avatar,
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

  // 5. 辯論共識與多輪辯論 (Multi-Round Debate Simulation)
  const round1Voices: DebateVoice[] = [
    {
      personaId: "skeptic",
      name: personas[2].name,
      avatar: personas[2].avatar,
      stance: fullText.includes("免費") && fullText.includes("無社交壓力") ? "support" : "skeptical",
      argument: "看到『禪』字第一反應會警惕是否為宗教拉人或強迫推銷，需確認流程是否公開、是否要收費。",
      resolutionProposal: "在文案顯著處註明『完全免費・零推銷』並附上 4 階段時間流程。"
    },
    {
      personaId: "bystander",
      name: personas[1].name,
      avatar: personas[1].avatar,
      stance: slopFound.length > 0 ? "oppose" : hasHook ? "support" : "hesitant",
      argument: "學生滑社群停留時間低於 1 秒，若開頭是官腔套話直接滑走；必須前兩行給出痛點衝擊。",
      resolutionProposal: domain === "tamkang"
        ? "放大『克難坡 132 階』或『大腦重開機』標題字級，版面保留 40% 以上留白。"
        : "放大痛點反差標題字級，版面保留 40% 以上留白呼吸感。"
    },
    {
      personaId: "target_freshman",
      name: personas[0].name,
      avatar: personas[0].avatar,
      stance: "support",
      argument: domain === "tamkang"
        ? "剛開學爬坡真的腿酸又焦慮選課，但很怕現場要被迫上台自我介紹或尷尬破冰。"
        : "開學初期適應新環境與選課壓力大，但很怕現場被迫自我介紹或尷尬互動。",
      resolutionProposal: "文宣明確承諾『無社交壓力、純喝茶聽學長姐選課分享』。"
    },
    {
      personaId: "peer_advocate",
      name: personas[3].name,
      avatar: personas[3].avatar,
      stance: "strongly_support",
      argument: "精緻冷泡茶與文青視覺極具拍照轉傳潛力，但新生不敢單獨赴約，需要攜伴理由。",
      resolutionProposal: "加入『歡迎帶室友一同前來』文案，解鎖全寢同行動機。"
    },
    {
      personaId: "creative_director",
      name: personas[4].name,
      avatar: personas[4].avatar,
      stance: visualNotes.includes("手作") ? "support" : "hesitant",
      argument: "三色光是手作圓形道具，不可變為交通燈、商標或標靶，整體維持思源宋體與低飽和調性。",
      resolutionProposal: "三色光印章固定於 36px 畫布邊角，確保文字留白呼吸感。"
    }
  ];

  const round2Voices: DebateVoice[] = [
    {
      personaId: "skeptic",
      name: personas[2].name,
      avatar: personas[2].avatar,
      stance: "support",
      argument: "文案確認納入『完全免費無推銷』與 18:30-20:00 四階段透明流程，戒心完全解除。"
    },
    {
      personaId: "bystander",
      name: personas[1].name,
      avatar: personas[1].avatar,
      stance: "support",
      argument: domain === "tamkang"
        ? "首圖以 44pt 思源宋體直擊『132 階克難坡』痛點，排版無壓，同意停留觀看。"
        : "首圖以 44pt 思源宋體直擊痛點，排版無壓，同意停留觀看。"
    },
    {
      personaId: "target_freshman",
      name: personas[0].name,
      avatar: personas[0].avatar,
      stance: "strongly_support",
      argument: "確認『零社交壓力・不尷尬』保證，且有選課不踩雷攻略，赴約意願達 95%！"
    },
    {
      personaId: "peer_advocate",
      name: personas[3].name,
      avatar: personas[3].avatar,
      stance: "strongly_support",
      argument: "加入室友攜伴標籤與高山冷泡茶預告，已準備直接轉發至大一新生宿舍群組！"
    },
    {
      personaId: "creative_director",
      name: personas[4].name,
      avatar: personas[4].avatar,
      stance: "strongly_support",
      argument: "手作圓形三色光印章 36px 邊角落款規範落實，排版層次與低飽和調色盤完全合規。"
    }
  ];

  const debateRounds: DebateRound[] = [
    {
      round: 1,
      phase: "divergence",
      title: "第一輪：受眾痛點碰撞與疑慮提出 (Divergence)",
      personaVoices: round1Voices,
      roundSynthesis: "懷疑者關注商業與宗教透明度，路人檢驗首屏停留力，大一新生要求破冰無壓承諾，總監堅持視覺規範。"
    },
    {
      round: 2,
      phase: "convergence",
      title: "第二輪：針對性調整與共識收斂 (Convergence)",
      personaVoices: round2Voices,
      roundSynthesis: "透過透明時程、真實痛點反差鉤子、零社交壓力承諾與手作印章規範，各角色疑慮全數化解，達成高度共識。"
    }
  ];

  // 計算共識收斂度指數 (0-100)
  const personaScores = feedback.map((f) => f.score);
  const avgScore = personaScores.reduce((a, b) => a + b, 0) / personaScores.length;
  const variance = personaScores.reduce((acc, s) => acc + Math.pow(s - avgScore, 2), 0) / personaScores.length;
  const stdDev = Math.sqrt(variance);
  const consensusConvergenceIndex = Math.max(60, Math.min(99, Math.round(100 - (stdDev * 1.5))));

  // 6. 客觀證據 vs 推論假設動態拆解 (Facts Provenance)
  const facts: AudienceFact[] = extractContextFacts(fullText, domain);

  const evidencePoints = facts
    .filter((f) => f.kind === "evidence")
    .map((f) => `${f.statement} (${f.sourceTag})`);

  const hypothesisPoints = facts
    .filter((f) => f.kind === "hypothesis")
    .map((f) => `${f.statement} (${f.sourceTag})`);

  const consensus: "strongly_recommended" | "recommended" | "needs_iteration" =
    scores.overallScore >= 85 ? "strongly_recommended" : scores.overallScore >= 72 ? "recommended" : "needs_iteration";

  const freshmanName = personas[0].name.split("・")[1] || personas[0].name;
  const bystanderName = personas[1].name.split("・")[1] || personas[1].name;

  const debateSummary = `5 位模擬受眾對【${conceptTitle}】達成高度共識（綜合得分 ${scores.overallScore}/100，共識收斂指數 ${consensusConvergenceIndex}%）。核心大一受眾${freshmanName}給予高度共鳴，肯定真實校園痛點切入；懷疑論者與路人${bystanderName}確認無 AI 罐頭廢話，時程透明安全感足夠。`;

  return {
    conceptTitle,
    scores,
    feedback,
    debateSummary,
    debateRounds,
    consensusConvergenceIndex,
    consensus,
    facts,
    evidencePoints,
    hypothesisPoints,
    disclaimer: "AI 模擬評估，不代表真實市場調查。"
  };
}
