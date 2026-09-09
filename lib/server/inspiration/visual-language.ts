export type Provenance =
  | "FACT"
  | "EVIDENCE"
  | "INFERENCE"
  | "INSPIRATION"
  | "UNKNOWN";

export type PatternKind = "design" | "layout" | "hook" | "cta" | "audience";

export type Suitability = "keep" | "adapt" | "avoid";

export interface PatternEvidence {
  provenance: Provenance;
  source: string;
  note: string;
}

export interface VisualPattern {
  id: string;
  kind: PatternKind;
  suitability: Suitability;
  title: string;
  summary: string;
  why: string;
  audienceTwins: string[];
  cues: string[];
  evidence: PatternEvidence[];
  visualAgentInput: string;
  copywritingAgentInput: string;
}

export interface StoryBeat {
  frame: number;
  onImage: string;
  caption: string;
  maxChars: number;
}

export interface CampaignSlot {
  id: string;
  title: string;
  format: "4:5" | "9:16" | "carousel";
  date: string;
  status: "done" | "ready" | "next" | "later";
  patternIds: string[];
  location: { value: string; provenance: Provenance };
  visualAgentInput: string;
  copywritingAgentInput: string;
  beats?: StoryBeat[];
}

export interface LiveWatch {
  today: string;
  instagramConnected: false;
  feed: {
    url: string;
    postedAt: string;
    hook: string;
    stale: boolean;
    staleReason: string | null;
    provenance: "EVIDENCE";
  };
  story: {
    seen: false;
    provenance: "UNKNOWN";
    note: string;
  };
  drivePlan: {
    fairStoryStatus: string;
    provenance: "FACT";
  };
  planVsLive: string;
}

export interface VisualLanguageBrief {
  account: "tku_zc";
  observedAt: string;
  instagramConnected: false;
  imageReadCount: number;
  fullGridUnknown: true;
  storiesUnknown: true;
  reelsMotionUnknown: true;
  biggestProblem: string;
  improvements: string[];
  live: LiveWatch;
  nextSlot: CampaignSlot;
  slots: CampaignSlot[];
  keep: VisualPattern[];
  avoid: VisualPattern[];
  visualAgent: { brief: string; do: string[]; dont: string[] };
  copywritingAgent: { brief: string; do: string[]; dont: string[] };
}

const TWINS = {
  dorm: "剛搬來淡水的住宿新生",
  commute: "每天通勤的新生",
  shy: "內向、怕尷尬的新生",
  friends: "想交朋友的新生",
  religion: "想參加社團但怕太宗教的新生",
  curious: "對禪有興趣但不了解的新生",
  activity: "對禪完全沒興趣、只想找活動的新生",
  grow: "想提升自己的人",
  stress: "課業壓力高的人",
  lost: "覺得自己還不知道大學要做什麼的人",
} as const;

const KEEP: VisualPattern[] = [
  {
    id: "design-turtle-student",
    kind: "design",
    suitability: "keep",
    title: "2D 龜龜＋學生插畫",
    summary: "圓臉發芽龜龜與短髮學生，是目前唯一可辨識的角色系統。",
    why: "新生能在貼文之間認出同一社團，不必先讀「禪學社」三個字。",
    audienceTwins: [TWINS.shy, TWINS.friends, TWINS.curious],
    cues: ["龜龜", "turtle", "插畫"],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/Dc0jgihkyFV/",
        note: "2026-09-03 FAQ 封面：2D 龜龜＋學生頭像＋校園池景。",
      },
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/DdBKSPrEwPz/",
        note: "2026-09-08 淡水生存指南：同一隻發芽龜龜＋淡江鐘樓剪影。",
      },
      {
        provenance: "FACT",
        source: "Drive 1151滾動式調整網宣",
        note: "2026-08-28 已完成「畫出龜龜&人各表情」網宣輔助貼圖。",
      },
    ],
    visualAgentInput:
      "4:5 平面插畫，延續發芽圓臉龜龜與短髮學生，奶油底＋鼠尾草綠，不要改成 3D 寫實人物。",
    copywritingAgentInput: "角色可當語氣：小編＋龜龜，像學姊說話，不要廟口解說。",
  },
  {
    id: "design-campus-landmark",
    kind: "design",
    suitability: "keep",
    title: "淡江地標當背景",
    summary: "鐘樓、淡水河、天空與綠地，比蓮花更能說「這是淡大的社團」。",
    why: "住宿與通勤新生會停在自己正在過的地方，而不是抽象禪意。",
    audienceTwins: [TWINS.dorm, TWINS.commute, TWINS.lost],
    cues: ["淡江", "鐘樓", "淡水"],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/DdBKSPrEwPz/",
        note: "生存指南封面右下角鐘樓＋「淡江大學」標籤。",
      },
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/Dc0jgihkyFV/",
        note: "FAQ 封面遠處可見校園建築與池塘。",
      },
    ],
    visualAgentInput:
      "可用淡江鐘樓剪影或淡水河遠景當底，佔畫面不到 25%，不要變成旅遊明信片。",
    copywritingAgentInput: "地點寫「文館左側」「淡水天氣」，不要寫抽象道場。",
  },
  {
    id: "hook-boba-reward",
    kind: "hook",
    suitability: "keep",
    title: "先給好處再開社團",
    summary: "封面只講「來玩專注力遊戲，就有機會拿手搖飲」。",
    why: "只想找活動的新生會停；怕宗教的人還不必先面對「禪」。",
    audienceTwins: [TWINS.activity, TWINS.friends, TWINS.religion],
    cues: ["手搖飲", "專注力遊戲", "是的你沒看錯"],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/DdDVyBMk0Xb/",
        note: "2026-09-08 社博封面：手搖飲＋柴犬，主標不含「禪」。",
      },
      {
        provenance: "FACT",
        source: "Drive 期初宣傳區／純社博文",
        note: "文案已定「來禪學社的攤位玩專注力遊戲…把手搖飲帶回家」。",
      },
    ],
    visualAgentInput:
      "一個超大物件（手搖飲）＋一句 8 字內鉤子；社團名縮小到角落。",
    copywritingAgentInput:
      "第一句不要出現禪／靜定／宗教。用「來玩」「有機會拿」。",
  },
  {
    id: "hook-tamsui-weather",
    kind: "hook",
    suitability: "keep",
    title: "淡水生存指南",
    summary: "先幫新生活下去（雨、風、濕），再讓人覺得這個社團懂我。",
    why: "住宿新生與通勤新生有真實痛點；這不是心靈雞湯。",
    audienceTwins: [TWINS.dorm, TWINS.commute, TWINS.lost],
    cues: ["淡水", "天氣", "生存指南", "雨"],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/DdBKSPrEwPz/",
        note: "封面：「來淡江，先學會跟淡水天氣相處！」晴／雨／風三圖。",
      },
      {
        provenance: "FACT",
        source: "Drive 期初宣傳區／淡大生存指南",
        note: "雨傘、薄外套、雨鞋、除濕機，是內部已寫好的文案。",
      },
    ],
    visualAgentInput:
      "天空藍＋三個天氣圖示＋龜龜。資訊圖，不是風景照。",
    copywritingAgentInput:
      "用「一天可以全都來一輪」這種淡水笑話，不要改成氣象報告。",
  },
  {
    id: "hook-faq-religion",
    kind: "hook",
    suitability: "adapt",
    title: "先回答「禪是宗教嗎」",
    summary: "FAQ 輪播直接拆新生最大疑慮，但封面不要放蓮花當第一印象。",
    why: "怕宗教的人需要這句；可是蓮花圖會先把他們滑走。",
    audienceTwins: [TWINS.religion, TWINS.curious, TWINS.shy],
    cues: ["禪是宗教", "常見問題", "靜不下來"],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/Dc0jgihkyFV/",
        note: "2026-09-03 FAQ 文案第 2 題「禪是宗教嗎？」；封面有蓮花。",
      },
      {
        provenance: "FACT",
        source: "Drive 期初宣傳區／FAQ",
        note: "五題 FAQ 已定稿，含認證規則。",
      },
    ],
    visualAgentInput:
      "輪播封面只放「常見問題」＋學生＋龜龜；蓮花改到內頁或拿掉。",
    copywritingAgentInput:
      "封面問句用「我們在做什麼／會不會很宗教」；詳答放第 2 頁。",
  },
  {
    id: "layout-cover-then-facts",
    kind: "layout",
    suitability: "adapt",
    title: "封面鉤子、第二頁才放時間地點",
    summary: "社課海報把時間地點做成底欄，有用，但封面字太多。",
    why: "手機一秒只能讀一句；日期欄適合第 2 頁或限動。",
    audienceTwins: [TWINS.stress, TWINS.commute, TWINS.activity],
    cues: ["時間：", "地點：", "19:00"],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/p/DV5AccUEaW-/",
        note: "2026-03-14 社課海報底欄：3/18 19:00–21:30、宮燈 H117。",
      },
      {
        provenance: "FACT",
        source: "Drive 1151滾動式調整網宣",
        note: "社博宣傳指定 IG 限動 9/10；茶會／演講貼文與限動分拆。",
      },
    ],
    visualAgentInput:
      "4:5 封面不放時間地點；第 2 頁才放日期、教室、QR。9:16 限動可放地點照片。",
    copywritingAgentInput:
      "封面一句話。Caption 前兩行才是時間地點與表單。",
  },
  {
    id: "cta-booth-low-pressure",
    kind: "cta",
    suitability: "keep",
    title: "低壓到場：來晃晃就好",
    summary: "社博 CTA 是「來攤位晃晃／玩遊戲」，不是「立刻入社」。",
    why: "怕尷尬的人願意走近；填表可以發生在玩完之後。",
    audienceTwins: [TWINS.shy, TWINS.activity, TWINS.friends],
    cues: ["攤位", "晃晃", "文館左側", "社博"],
    evidence: [
      {
        provenance: "FACT",
        source: "Drive 期初宣傳區／社博限動",
        note: "「不知道要加什麼社團？還是只是剛好逛到、想來看看？都歡迎」。",
      },
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/DdDVyBMk0Xb/",
        note: "擺攤 9/10、9/11、9/14–17，文館左側。",
      },
    ],
    visualAgentInput:
      "9:16 限動：真實文館左側照片＋「我們在這裡」＋手搖飲貼紙。",
    copywritingAgentInput:
      "CTA 用「來玩／來晃晃」。入社與表單放在第二層。",
  },
  {
    id: "audience-line-play-and-still",
    kind: "audience",
    suitability: "keep",
    title: "靜下來，也能玩起來",
    summary: "目前最能同時安撫怕宗教與只想玩的人的一句話。",
    why: "把「靜」從功課改成可以跟遊戲並存的狀態。",
    audienceTwins: [TWINS.religion, TWINS.activity, TWINS.friends, TWINS.grow],
    cues: ["靜下來", "玩起來"],
    evidence: [
      {
        provenance: "FACT",
        source: "Drive 期初宣傳區／純社博文",
        note: "「讓自己『靜下來，也能玩起來』」已是 115-1 對外句。",
      },
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/DdDVyBMk0Xb/",
        note: "社博 caption 使用同一句。",
      },
    ],
    visualAgentInput: "不要把這句做成金句海報；讓畫面自己又靜又玩。",
    copywritingAgentInput: "保留這句當品牌線。不要再疊「破繭成蝶」「無雙模式」。",
  },
];

const AVOID: VisualPattern[] = [
  {
    id: "avoid-3d-ai-girl",
    kind: "design",
    suitability: "avoid",
    title: "3D AI 人物＋彩虹社名",
    summary: "Reels 封面用三維少女伸手，和 2D 龜龜、手搖飲貼文不是同一個社團。",
    why: "風格一換，品牌記憶歸零；也像廣告素材而不是淡大社團。",
    audienceTwins: [TWINS.shy, TWINS.religion],
    cues: [],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/reel/Dc70WgLRNYx/",
        note: "2026-09-05 Reels 封面：3D 少女＋五色「淡大禪學社」＋兩場活動字卡。",
      },
    ],
    visualAgentInput: "不要生成 3D／寫實 AI 人物當封面。角色鎖定既有 2D 龜龜。",
    copywritingAgentInput: "社名不要做彩虹裝飾字。活動名稱一行、日期一行。",
  },
  {
    id: "avoid-lotus-temple-first",
    kind: "design",
    suitability: "avoid",
    title: "蓮花／廟宇當第一眼",
    summary: "FAQ 封面前景大蓮花，但文案正在說「禪不是宗教」。",
    why: "怕宗教的新生會在讀字前滑走。",
    audienceTwins: [TWINS.religion, TWINS.activity],
    cues: [],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/tku_zc/p/Dc0jgihkyFV/",
        note: "FAQ 封面左下角大蓮花，與第 2 題互相打架。",
      },
      {
        provenance: "FACT",
        source: "Drive 115-1 期初演講企畫書",
        note: "內部精神句含「法輪／輪迴」；這是內部 FACT，不是對外 IG 用語。",
      },
    ],
    visualAgentInput: "封面不用蓮花特寫、寺廟、金箔、佛像剪影。",
    copywritingAgentInput:
      "對外不要用菩薩、法輪、輪迴、道場。改用靜下來、休息、認識自己。",
  },
  {
    id: "avoid-cram-hero-poster",
    kind: "layout",
    suitability: "avoid",
    title: "補習班英雄海報",
    summary: "人物打光、書本筆電環繞，看起來像升學廣告，不像茶會或社課。",
    why: "課業壓力高的人會覺得又要被說教；想交朋友的人看不出現場氣氛。",
    audienceTwins: [TWINS.stress, TWINS.friends, TWINS.shy],
    cues: [],
    evidence: [
      {
        provenance: "EVIDENCE",
        source: "https://www.instagram.com/p/DV5AccUEaW-/",
        note: "2026-03-14〈專注的力量〉：動漫少年指光、漂浮 3C。",
      },
      {
        provenance: "INSPIRATION",
        source: "https://www.instagram.com/fjcu_club/",
        note: "輔大社博遊戲主線很吵，不適合禪學社節奏。只當反例。",
      },
    ],
    visualAgentInput: "不要英雄姿勢、放射光、漂浮書本筆電。現場是坐下來。",
    copywritingAgentInput: "不要「領袖／強大／無雙模式」當封面。改成現場會發生的一件事。",
  },
];

const SLOTS: CampaignSlot[] = [
  {
    id: "faq-2026-08-31",
    title: "FAQ 貼文",
    format: "carousel",
    date: "2026-08-31",
    status: "done",
    patternIds: ["hook-faq-religion", "design-turtle-student"],
    location: { value: "不適用", provenance: "FACT" },
    visualAgentInput: "已上線。下一輪改版拿掉封面蓮花。",
    copywritingAgentInput: "已上線。保留「禪是宗教嗎」。",
  },
  {
    id: "fair-story-2026-09-10",
    title: "社博限動",
    format: "9:16",
    date: "2026-09-10",
    status: "next",
    patternIds: ["hook-boba-reward", "cta-booth-low-pressure"],
    location: { value: "文館左側", provenance: "FACT" },
    visualAgentInput:
      "今日社博。9:16 限動：上「我們在這裡呦」下「來玩就有機會拿手搖飲」。像素安全區見 Visual Agent PR #80，不要重做通用規格。能拍文館左側就用實景；沒有實景就 2D 龜龜＋手搖飲，標 UNKNOWN。不要再用 9/8「明天開始」封面。",
    copywritingAgentInput:
      "9/8 貼文「社博明天就要開始」在 9/10 已過期。改成「社博開始啦／我們在文館左側」。日期 9/10、11、9/14–17。不要捏造教室。限動是否已發 = UNKNOWN。",
    beats: [
      {
        frame: 1,
        onImage: "我們在這裡呦",
        caption: "社博開始啦。不知道加什麼社也可以來晃晃。",
        maxChars: 8,
      },
      {
        frame: 2,
        onImage: "文館左側",
        caption: "9/10、9/11、9/14–17。來攤位玩專注力遊戲。",
        maxChars: 8,
      },
      {
        frame: 3,
        onImage: "來玩拿手搖飲",
        caption: "靜下來，也能玩起來。",
        maxChars: 8,
      },
    ],
  },
  {
    id: "tea-feed-2026-09-06",
    title: "期初茶會貼文",
    format: "4:5",
    date: "2026-09-06",
    status: "ready",
    patternIds: ["layout-cover-then-facts", "audience-line-play-and-still"],
    location: { value: "待定", provenance: "UNKNOWN" },
    visualAgentInput:
      "4:5 封面只放「改變自己從靜定開始」＋龜龜。時間地點第 2 頁；地點未定就寫待公布，不要發明教室。",
    copywritingAgentInput:
      "2026/9/30 19:00–21:30。地點 UNKNOWN。表單 https://forms.gle/Xs4PXyWKQW5ob29z6。",
  },
  {
    id: "talk-feed-2026-09-06",
    title: "期初演講貼文",
    format: "4:5",
    date: "2026-09-06",
    status: "ready",
    patternIds: ["layout-cover-then-facts"],
    location: { value: "待定", provenance: "UNKNOWN" },
    visualAgentInput:
      "不要 3D 少女、不要彩虹社名。2D 龜龜＋一句「由數字探索自己」。",
    copywritingAgentInput:
      "2026/10/7 19:00–21:30，講師盧玫竹。地點 UNKNOWN。不要內部法輪句。",
  },
];

export function liveWatch(today = "2026-09-10"): LiveWatch {
  const hook = "社博明天就要開始啦！！";
  const postedAt = "2026-09-08";
  const stale = /明天/.test(hook) && today > postedAt;
  return {
    today,
    instagramConnected: false,
    feed: {
      url: "https://www.instagram.com/tku_zc/p/DdDVyBMk0Xb/",
      postedAt,
      hook,
      stale,
      staleReason: stale
        ? "9/8 封面與 caption 寫「明天開始」；" + today + " 已過期，不可再當當日素材。"
        : null,
      provenance: "EVIDENCE",
    },
    story: {
      seen: false,
      provenance: "UNKNOWN",
      note: "未授權讀限動。Drive 計劃 9/10 發社博限動，狀態仍是「新增」，不代表已發。",
    },
    drivePlan: {
      fairStoryStatus: "新增",
      provenance: "FACT",
    },
    planVsLive:
      "Feed 已有 9/8 社博預告；9/10 限動現場 UNKNOWN。不要把預告文案當成當日限動。",
  };
}

export function tkuVisualLanguage(today = "2026-09-10"): VisualLanguageBrief {
  const live = liveWatch(today);
  return {
    account: "tku_zc",
    observedAt: today,
    instagramConnected: false,
    imageReadCount: 5,
    fullGridUnknown: true,
    storiesUnknown: true,
    reelsMotionUnknown: true,
    biggestProblem:
      "封面每篇換一套畫風，新生 0.5 秒認不出同一社團，也看不出走進攤位會發生什麼。",
    improvements: [
      "鎖定 2D 龜龜＋2D 學生為唯一角色，停用 3D AI 人物。",
      "封面只放 5–8 字鉤子＋一個物件；時間地點改到第 2 頁或限動。",
      "社博／茶會限動用文館左側實景，不要再用插畫地圖代替現場。",
      "蓮花與廟宇不要當第一眼；FAQ 保留「禪是宗教嗎」但畫面先像校園生活。",
      "CTA 用「來玩／拿手搖飲／文館左側」，表單放第二層。",
    ],
    live,
    nextSlot: SLOTS.find((slot) => slot.status === "next") || SLOTS[1],
    slots: SLOTS,
    keep: KEEP,
    avoid: AVOID,
    visualAgent: {
      brief:
        "115-1 網宣請產出 4:5 貼文與 9:16 限動，延續 FAQ／生存指南的 2D 插畫，不要新風格。",
      do: [
        "奶油底、天空藍、龜綠、手寫感中文。",
        "主角：發芽圓臉龜龜，或手搖飲／雨傘一個物件。",
        "淡江鐘樓最多當小背景。",
        "4:5 封面少字；9:16 可放「我們在這裡」＋實景。",
      ],
      dont: [
        "3D／寫實 AI 人物。",
        "蓮花特寫、寺廟、金箔。",
        "彩虹裝飾社名。",
        "補習班英雄海報。",
        "假裝已讀完整 IG 格或已連接 Instagram。",
      ],
    },
    copywritingAgent: {
      brief:
        "對外文案用新生生活開口，品牌線保留「靜下來，也能玩起來」。內部企畫宗教句不要進 IG。",
      do: [
        "開頭：雨、通勤、不知道加什麼社、來玩。",
        "FAQ 保留「禪是宗教嗎／靜不下來也沒關係」。",
        "社博 CTA：來攤位晃晃、專注力遊戲、手搖飲、文館左側。",
        "茶會／演講：教授沒教的休息法、改變自己從靜定開始；地點未定要標 UNKNOWN。",
      ],
      dont: [
        "封面第一句就「禪／靜定／宗教」。",
        "菩薩、法輪、輪迴、道場。",
        "倒數逼單、原價最後一天。",
        "把表單藏在 200 字之後才出現。",
        "捏造教室或講師。",
        "社博當天不要再用「明天開始」。",
      ],
    },
  };
}

export function visualLanguageHandoff(today = "2026-09-10") {
  const brief = tkuVisualLanguage(today);
  return [
    "禪學社視覺語言交接（Grok 02，非 Instagram 連線）",
    "instagramConnected=false imageRead=" +
      brief.imageReadCount +
      " fullGrid=UNKNOWN stories=UNKNOWN",
    "現場：" + brief.live.planVsLive,
    brief.live.feed.stale ? "過期鉤子：" + brief.live.feed.staleReason : "Feed 鉤子未過期。",
    "最大問題：" + brief.biggestProblem,
    "Visual Agent：" + brief.visualAgent.brief,
    "要做：" + brief.visualAgent.do.join("／"),
    "不要：" + brief.visualAgent.dont.join("／"),
    "Copywriting Agent：" + brief.copywritingAgent.brief,
    "要做：" + brief.copywritingAgent.do.join("／"),
    "不要：" + brief.copywritingAgent.dont.join("／"),
    "值得學：" + brief.keep.map((item) => item.kind + "·" + item.title).join("；"),
    "不要用：" + brief.avoid.map((item) => item.title).join("；"),
    "下一步：" +
      brief.nextSlot.format +
      " " +
      brief.nextSlot.title +
      " " +
      brief.nextSlot.date +
      " @" +
      brief.nextSlot.location.value +
      " (" +
      brief.nextSlot.location.provenance +
      ")",
    "Visual 下一步：" + brief.nextSlot.visualAgentInput,
    "文案下一步：" + brief.nextSlot.copywritingAgentInput,
  ].join("\n");
}

const CUE_INDEX = [...KEEP].map((pattern) => ({
  id: pattern.id,
  title: pattern.title,
  cues: pattern.cues,
}));

export function matchCaptionPatterns(caption: string) {
  const text = caption.trim();
  if (!text) return [] as string[];
  return CUE_INDEX.filter((pattern) =>
    pattern.cues.some((cue) => cue && text.includes(cue)),
  ).map((pattern) => pattern.title);
}
