import { clampScore } from "../audience";
import { SIMULATION } from "./types";
import type {
  ArtifactKind,
  FreshmanPersonaId,
  PersonaReaction,
  TwinMetric,
  TwinPanel,
  TwinScores,
} from "./types";
import { ARTIFACT_KINDS, FRESHMAN_PERSONA_IDS, TWIN_METRICS } from "./types";

export const TWIN_METRIC_LABELS: Record<TwinMetric, string> = {
  stopRate: "會停下來",
  understandability: "看得懂",
  relevance: "跟我有關",
  trust: "可信",
  peerShareability: "想轉傳",
  ctaClarity: "CTA 清楚",
  religiousPressure: "宗教壓力",
  aiSlop: "AI 味",
  visualAttraction: "視覺",
};

export const KIND_LABELS: Record<ArtifactKind, string> = {
  poster: "海報",
  ig: "IG",
  form: "表單",
  event: "活動",
  booth: "攤位",
  layout: "場佈",
  copy: "文案",
};

export const RISK_METRICS = new Set<TwinMetric>([
  "religiousPressure",
  "aiSlop",
]);

const TWIN_MIN = 12;
const TWIN_MAX = 78;

type PersonaDef = {
  id: FreshmanPersonaId;
  label: string;
  notice: string;
};

export const FRESHMAN_PERSONAS: PersonaDef[] = [
  { id: "dorm", label: "住宿新生", notice: "先看在不在校園、晚上回不回得了宿舍。" },
  { id: "commute", label: "通勤新生", notice: "先看時間、捷運、會不會拖太晚。" },
  { id: "introvert", label: "內向新生", notice: "先看會不會被點名、能不能只坐著。" },
  { id: "extrovert", label: "社牛", notice: "先看能不能認識人、現場熱不熱。" },
  { id: "academic", label: "課業壓力型", notice: "先看時長、會不會佔讀書時間。" },
  { id: "social", label: "想交朋友型", notice: "先看有沒有人可以一起、門檻高不高。" },
  { id: "religion_wary", label: "怕宗教型", notice: "先看是不是在傳教。" },
  { id: "zen_curious", label: "對禪好奇型", notice: "先看實際會做什麼，不是口號。" },
  { id: "uninterested", label: "完全沒興趣型", notice: "先看有沒有食物、同學、或一眼好玩。" },
  { id: "design_eye", label: "設計系視覺敏感型", notice: "先看版面，文案排第二。" },
];

export interface ArtifactSignals {
  local: boolean;
  life: boolean;
  jargon: boolean;
  cta: boolean;
  timePlace: boolean;
  socialLowBarrier: boolean;
  commuteCue: boolean;
  dormCue: boolean;
  formFriction: boolean;
  religionField: boolean;
  preachy: boolean;
  durationClear: boolean;
  longCommitment: boolean;
  aiSlop: boolean;
  visualDescribed: boolean;
  visualSpecific: boolean;
  unclearActivity: boolean;
  peerInvite: boolean;
  food: boolean;
  forcedShare: boolean;
  stage: boolean;
  walkUp: boolean;
  unknownPlace: boolean;
}

export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

export function clampTwin(value: number) {
  return clampScore(Math.max(TWIN_MIN, Math.min(TWIN_MAX, value)));
}

function band(value: number): "low" | "medium" | "high" {
  if (value >= 58) return "high";
  if (value >= 38) return "medium";
  return "low";
}

export function extractSignals(input: {
  kind: ArtifactKind;
  title?: string;
  copy: string;
  visualNotes?: string;
}): ArtifactSignals {
  const text = `${input.title || ""}\n${input.copy}\n${input.visualNotes || ""}`;
  const visual = (input.visualNotes || "").trim();
  const activityCue =
    /茶會|迎新|社課|體驗|靜坐|散步|攤位|博覽|工作坊|電影|野餐|共修/.test(text);
  return {
    local: /淡江|淡水|克難坡|驚聲|宮燈|學餐|覺生|文館/.test(text),
    life: /朋友|社團|大一|迎新|茶會|生活|校園|宿舍|捷運/.test(text),
    jargon: /靜定|禪修|開示|法會|共修|般若|正念禪|止觀/.test(text),
    cta: /來參加|報名|填表|掃QR|掃 QR|時間|地點|週[一二三四五六日]|[0-9]點/.test(
      text,
    ),
    timePlace: /週[一二三四五六日]|[0-9]{1,2}\s*[:：點]|教室|活動中心|[0-9]+\/[0-9]+/.test(
      text,
    ),
    socialLowBarrier: /來坐|不用準備|認識朋友|可以只聽|低門檻|路過|自由參加/.test(
      text,
    ),
    commuteCue: /捷運|下課後|通勤|淡水線|不用過夜|一小時內/.test(text),
    dormCue: /宿舍|校園內|走路|晚上|宿區/.test(text),
    formFriction: /學號|家長|必填|緊急聯絡|身分證/.test(text),
    religionField: /宗教信仰|信仰欄|皈依|法名/.test(text),
    preachy: /信佛|解脫|業障|開示|法師開示|靈魂救贖|你必須/.test(text),
    durationClear: /[0-9]+\s*(分鐘|小時)|90 分|一個半鐘|到\s*[0-9]/.test(text),
    longCommitment: /三天|兩天一夜|過夜|營隊|全程參與|不可遲到/.test(text),
    aiSlop:
      /金色光暈|內在宇宙|靈魂覺醒|無臉|完美對稱|命運召喚|療癒系光粒|賦能你的人生/.test(
        text,
      ),
    visualDescribed: visual.length > 0,
    visualSpecific: /克難坡|淡水捷運|實拍|手寫|活動中心|攤位桌|茶具/.test(
      visual || text,
    ),
    unclearActivity: !activityCue,
    peerInvite: /同學|一起|揪|帶朋友|轉傳/.test(text),
    food: /茶|點心|喝一杯|免費吃|麵包|手搖飲/.test(text),
    forcedShare: /自我介紹|輪流分享|麥克風|被點名|必須發言/.test(text),
    stage: /講台|面向講者|不可離座|中央座位/.test(text),
    walkUp: /自由走動|可以先看|路過|不攔人|自行取閱/.test(text),
    unknownPlace: /地點\s*[：:]\s*(待定|待確認|OOOO|TBD)/.test(text),
  };
}

function baseScores(signals: ArtifactSignals, kind: ArtifactKind): Record<TwinMetric, number> {
  const stop = signals.life || signals.local || signals.food || signals.socialLowBarrier
    ? 54
    : signals.jargon && signals.unclearActivity
      ? 24
      : 38;
  const understand = signals.unclearActivity
    ? signals.jargon
      ? 28
      : 42
    : signals.jargon
      ? 46
      : 66;
  const relevance = signals.life ? 58 : 36;
  const trust = signals.local && signals.timePlace ? 60 : signals.preachy ? 30 : 48;
  const share = signals.peerInvite || signals.socialLowBarrier ? 56 : 30;
  const cta = signals.cta && signals.timePlace ? 68 : signals.cta ? 48 : 26;
  const pressure = signals.preachy || signals.religionField
    ? 70
    : signals.jargon && !signals.life
      ? 62
      : signals.jargon
        ? 44
        : 18;
  const slop = signals.aiSlop ? 66 : signals.unclearActivity && signals.jargon ? 48 : 22;
  let visual = 40;
  if (kind === "copy" || kind === "form") visual = signals.visualDescribed ? 44 : 34;
  else if (!signals.visualDescribed) visual = 26;
  else visual = signals.visualSpecific ? 64 : signals.aiSlop ? 22 : 46;
  return {
    stopRate: stop,
    understandability: understand,
    relevance,
    trust,
    peerShareability: share,
    ctaClarity: cta,
    religiousPressure: pressure,
    aiSlop: slop,
    visualAttraction: visual,
  };
}

function applyPersona(
  id: FreshmanPersonaId,
  kind: ArtifactKind,
  signals: ArtifactSignals,
  base: Record<TwinMetric, number>,
): Record<TwinMetric, number> {
  const s = { ...base };
  const bump = (key: TwinMetric, delta: number) => {
    s[key] += delta;
  };
  if (id === "dorm") {
    bump("relevance", signals.dormCue || kind === "booth" ? 10 : -6);
    bump("stopRate", signals.dormCue || signals.local ? 8 : -4);
    if (signals.longCommitment) bump("stopRate", -10);
  }
  if (id === "commute") {
    bump("relevance", signals.commuteCue || (signals.timePlace && !signals.unknownPlace) ? 10 : -8);
    bump("ctaClarity", signals.timePlace && !signals.unknownPlace ? 6 : -10);
    bump("stopRate", signals.timePlace ? 6 : -8);
    if (signals.unknownPlace) bump("trust", -8);
    if (signals.longCommitment) bump("stopRate", -12);
  }
  if (id === "introvert") {
    bump("trust", signals.socialLowBarrier ? 10 : signals.forcedShare ? -16 : -4);
    bump("stopRate", signals.forcedShare || signals.stage ? -14 : signals.socialLowBarrier ? 8 : 0);
    bump("religiousPressure", signals.forcedShare ? 8 : 0);
  }
  if (id === "extrovert") {
    bump("stopRate", signals.socialLowBarrier || signals.peerInvite ? 12 : -6);
    bump("peerShareability", 10);
    bump("relevance", kind === "booth" || kind === "event" ? 8 : 0);
    if (signals.preachy) bump("stopRate", -10);
  }
  if (id === "academic") {
    bump("relevance", signals.durationClear ? 8 : -8);
    bump("stopRate", signals.longCommitment ? -16 : signals.durationClear ? 6 : -4);
    bump("understandability", signals.timePlace ? 6 : -6);
  }
  if (id === "social") {
    bump("relevance", signals.socialLowBarrier || signals.peerInvite ? 12 : -6);
    bump("peerShareability", signals.peerInvite ? 12 : 4);
    bump("stopRate", signals.life ? 8 : -4);
    if (signals.preachy) bump("trust", -10);
  }
  if (id === "religion_wary") {
    bump("religiousPressure", signals.jargon ? 14 : 0);
    bump("trust", signals.preachy || signals.religionField ? -18 : signals.life ? 6 : 0);
    bump("stopRate", signals.preachy ? -16 : signals.life && !signals.jargon ? 6 : -8);
    bump("relevance", signals.preachy ? -12 : 0);
  }
  if (id === "zen_curious") {
    bump("relevance", signals.jargon && !signals.unclearActivity ? 12 : signals.unclearActivity ? -8 : 4);
    bump("understandability", signals.unclearActivity ? -10 : 8);
    bump("stopRate", signals.unclearActivity && signals.jargon ? -6 : 8);
  }
  if (id === "uninterested") {
    bump("relevance", signals.food || signals.peerInvite ? 6 : -16);
    bump("stopRate", signals.food || signals.visualSpecific ? 8 : -14);
    bump("peerShareability", -8);
    if (signals.jargon) bump("stopRate", -10);
  }
  if (id === "design_eye") {
    bump("visualAttraction", signals.visualSpecific ? 10 : signals.aiSlop ? -16 : signals.visualDescribed ? 0 : -12);
    bump("aiSlop", signals.aiSlop ? 10 : 0);
    bump("stopRate", signals.visualSpecific ? 10 : signals.aiSlop || !signals.visualDescribed ? -12 : -4);
    if (kind === "copy") bump("stopRate", 4);
  }
  if (kind === "form") {
    bump("ctaClarity", signals.cta ? 4 : -8);
    if (signals.formFriction) bump("trust", -8);
    if (signals.religionField) bump("religiousPressure", 12);
  }
  if (kind === "booth") {
    bump("stopRate", signals.walkUp ? 8 : signals.preachy ? -10 : 0);
  }
  if (kind === "layout") {
    bump("trust", signals.stage && id === "introvert" ? -12 : signals.walkUp ? 6 : 0);
  }
  const out = {} as Record<TwinMetric, number>;
  for (const key of TWIN_METRICS) out[key] = clampTwin(s[key]);
  return out;
}

function envelope(scores: Record<TwinMetric, number>): TwinScores {
  return {
    ...SIMULATION,
    scoreUse: "comparative",
    scores,
  };
}

function unknownsFor(
  id: FreshmanPersonaId,
  kind: ArtifactKind,
  signals: ArtifactSignals,
): string[] {
  const items: string[] = [];
  if (
    ["poster", "ig", "booth", "layout"].includes(kind) &&
    !signals.visualDescribed
  )
    items.push("沒有視覺描述，無法假裝已看圖");
  if (!signals.timePlace && (kind === "event" || kind === "poster" || kind === "ig"))
    items.push("時間或地點不清楚");
  if (signals.unknownPlace) items.push("地點尚未確認");
  if (signals.unclearActivity) items.push("看不出實際會做什麼");
  if (id === "commute" && !signals.commuteCue && !signals.timePlace)
    items.push("不知道會不會趕車");
  return items;
}

function reactionCopy(
  id: FreshmanPersonaId,
  kind: ArtifactKind,
  signals: ArtifactSignals,
  scores: Record<TwinMetric, number>,
): { firstReaction: string; why: string[] } {
  const kindLabel = KIND_LABELS[kind];
  if (id === "religion_wary" && (signals.preachy || scores.religiousPressure >= 58))
    return {
      firstReaction: `這張${kindLabel}看起來像在叫我信什麼，我會先滑掉。`,
      why: [
        "宗教壓力偏高：出現修行／開示／信仰向用語。",
        "看不出這只是社團活動還是宗教場合。",
      ],
    };
  if (id === "design_eye" && (signals.aiSlop || scores.visualAttraction <= 32))
    return {
      firstReaction: signals.aiSlop
        ? "文案很套版，我會當它是 AI 產物直接略過。"
        : signals.visualDescribed
          ? "版面很套版，我會當它是 AI 海報直接略過。"
          : "沒圖也沒版面說明，我沒辦法判斷這張好不好看。",
      why: [
        signals.aiSlop
          ? "出現光暈／靈魂覺醒等空靈套語，設計系會當成 AI 味。"
          : signals.visualDescribed
            ? "視覺線索偏空靈套版，不像校園實拍。"
            : "沒有視覺描述，視覺分數只是缺資料，不是好看。",
        "標題如果再空，我會覺得這社團不在意第一眼。",
      ],
    };
  if (id === "introvert" && (signals.forcedShare || signals.stage))
    return {
      firstReaction: "聽起來會被點名或坐在中間，我會不敢靠近。",
      why: [
        "有發言／講台壓力，不像可以只坐著。",
        "沒寫「不用準備、可以只聽」就會覺得門檻高。",
      ],
    };
  if (id === "uninterested" && scores.relevance <= 36)
    return {
      firstReaction: "這跟我要的大學生活無關，除非同學硬拉，否則不會停。",
      why: [
        "沒有食物、好玩或同學線索。",
        "禪相關詞如果當主標，對我只是噪音。",
      ],
    };
  if (id === "academic" && signals.longCommitment)
    return {
      firstReaction: "看起來很長，我怕期中會被吃掉，先收藏再說。",
      why: ["時長或過夜承諾太重。", "沒先寫短時長，課業壓力型不會當場答應。"],
    };
  if (id === "commute" && signals.unknownPlace)
    return {
      firstReaction: "時間有了但地點還待定，我不敢先排車。",
      why: ["Drive 文案若寫地點待定，通勤新生無法判斷走線。", "這是缺資料，不是已經好找。"],
    };
  if (id === "commute" && !signals.timePlace)
    return {
      firstReaction: "沒寫幾點結束，我不敢賭末班車。",
      why: ["通勤新生要時間地點才會停。", "沒交通線索就會假設會拖很晚。"],
    };
  if (id === "zen_curious" && signals.unclearActivity)
    return {
      firstReaction: "我其實想知道禪是什麼，但這句話沒告訴我會做什麼。",
      why: [
        "主標像口號，沒有體驗步驟。",
        "好奇型要的是「坐下喝杯茶／試 10 分鐘」，不是抽象詞。",
      ],
    };
  if (id === "dorm" && !signals.local && !signals.dormCue)
    return {
      firstReaction: "看不出在校園哪裡，我不一定願意為它走出宿區。",
      why: ["缺少宿舍或校園地點。", "住宿生要「走得到」才會停。"],
    };
  if (scores.stopRate >= 54 && scores.understandability >= 50)
    return {
      firstReaction:
        id === "extrovert"
          ? "有人、有事做，我會停下來問一句「現在可以加入嗎？」"
          : id === "social"
            ? "看起來可以認識人，我會想拉一個同學一起看。"
            : "我大概看得懂，會停一下看時間地點。",
      why: [
        signals.socialLowBarrier
          ? "低門檻見面比口號更容易停下。"
          : "活動線索比術語清楚。",
        signals.timePlace
          ? "時間地點有寫，比較敢行動。"
          : "還差時間地點，停得下來但不一定去。",
      ],
    };
  return {
    firstReaction: "我會再看一眼，但還不知道這跟我有什麼關係。",
    why: [
      "第一眼沒有足夠生活線索。",
      `${KIND_LABELS[kind]}缺少讓這個人格停下的具體理由。`,
    ],
  };
}

function decisions(scores: Record<TwinMetric, number>, kind: ArtifactKind, signals: ArtifactSignals) {
  const wouldStop = scores.stopRate >= 46 && scores.religiousPressure < 66;
  const wouldShare = scores.peerShareability >= 52 && scores.trust >= 44;
  const formOk = kind !== "form" || (!signals.religionField && scores.trust >= 46);
  const wouldFillForm =
    wouldStop && formOk && scores.ctaClarity >= 48 && scores.religiousPressure < 58;
  const wouldWalkIn =
    wouldStop &&
    scores.understandability >= 44 &&
    scores.religiousPressure < 60 &&
    (kind !== "booth" || !signals.preachy);
  const pressure = band(scores.religiousPressure);
  return { wouldStop, wouldShare, wouldFillForm, wouldWalkIn, pressure };
}

export function simulateFreshmanReactions(input: {
  kind?: string;
  title?: string;
  copy?: string;
  visualNotes?: string;
  institution?: string;
  location?: string;
}): TwinPanel {
  const requested = input.kind || "copy";
  const kind: ArtifactKind = isArtifactKind(requested) ? requested : "copy";
  const copy = input.copy || "";
  const signals = extractSignals({
    kind,
    title: input.title,
    copy,
    visualNotes: input.visualNotes,
  });
  const base = baseScores(signals, kind);
  const personas: PersonaReaction[] = FRESHMAN_PERSONAS.map((persona) => {
    const scores = applyPersona(persona.id, kind, signals, base);
    const copyBlock = reactionCopy(persona.id, kind, signals, scores);
    const choice = decisions(scores, kind, signals);
    return {
      personaId: persona.id,
      label: persona.label,
      firstReaction: copyBlock.firstReaction,
      why: copyBlock.why,
      ...choice,
      scores: envelope(scores),
      unknowns: unknownsFor(persona.id, kind, signals),
    };
  });
  const by = (metric: TwinMetric, risk = false) =>
    [...personas].sort((a, b) =>
      risk
        ? b.scores.scores[metric] - a.scores.scores[metric]
        : b.scores.scores[metric] - a.scores.scores[metric],
    )[0].personaId;
  const drop = [...personas].sort(
    (a, b) => a.scores.scores.stopRate - b.scores.scores.stopRate,
  )[0].personaId;
  const panelUnknowns = [
    ...new Set(personas.flatMap((item) => item.unknowns)),
  ].slice(0, 6);
  return {
    simulation: true,
    method: "rule_heuristic",
    truth: "SIMULATION",
    scoreUse: "comparative",
    disclaimer: SIMULATION.disclaimer + " 分數只拿來比較人格，不是轉換率或民調。",
    kind,
    kindLabel: KIND_LABELS[kind],
    unknowns: panelUnknowns,
    personas,
    mostLikelyToStop: by("stopRate"),
    mostLikelyToDrop: drop,
    highestPressure: by("religiousPressure", true),
  };
}

export function isTwinPanel(value: unknown): value is TwinPanel {
  if (!value || typeof value !== "object") return false;
  const item = value as TwinPanel;
  return (
    item.simulation === true &&
    item.scoreUse === "comparative" &&
    item.truth === "SIMULATION" &&
    Array.isArray(item.personas) &&
    item.personas.length === FRESHMAN_PERSONA_IDS.length
  );
}

export function assertComparativeScores(panel: TwinPanel) {
  const first = panel.personas[0].scores.scores;
  const varied = panel.personas.some((persona) =>
    TWIN_METRICS.some((key) => persona.scores.scores[key] !== first[key]),
  );
  const inflated = panel.personas.some((persona) =>
    TWIN_METRICS.some((key) => persona.scores.scores[key] >= 90),
  );
  return { varied, inflated };
}
