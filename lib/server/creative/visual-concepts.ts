import type { Activity, Fact } from "../../creative";
import { fieldLabels } from "../../creative";
import type { TruthClass } from "../truth";
import {
  VISUAL_FORMATS,
  type VisualFormat,
  type VisualFormatId,
} from "./formats";

export const VISUAL_CONCEPT_IDS = ["A", "B", "C"] as const;
export type VisualConceptId = (typeof VISUAL_CONCEPT_IDS)[number];

const ON_IMAGE_FIELDS = [
  "name",
  "date",
  "time",
  "location",
  "registration",
] as const;
type OnImageField = (typeof ON_IMAGE_FIELDS)[number];

export type VisualFactSlot = {
  field: OnImageField;
  label: string;
  value: string | null;
  state: Fact["state"] | "missing";
  classification: TruthClass | "NEEDS_VERIFICATION";
  onImage: boolean;
};

export type PlacementZone = {
  zone: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  note: string;
};

export type VisualConcept = {
  id: VisualConceptId;
  name: string;
  creativeDirection: string;
  layout: {
    formatId: VisualFormatId;
    grid: string;
    textCoverageMaxPct: number;
    zones: Record<string, PlacementZone>;
  };
  typography: {
    headline: string;
    subhead: string;
    info: string;
    cta: string;
    maxHeadlineChars: number;
    maxBodyChars: number;
  };
  imagePrompt: string;
  negativePrompt: string[];
  background: string;
  mainSubject: {
    kind: "photography" | "illustration_object" | "spatial";
    description: string;
    classification: "INSPIRATION";
  };
  ctaPlacement: PlacementZone & {
    copy: string | null;
    classification: TruthClass | "NEEDS_VERIFICATION";
  };
  qrPlacement: PlacementZone & { include: boolean; reason: string };
  logoSafeArea: PlacementZone;
  visualHierarchy: string[];
  rendered: false;
  generatedImage: false;
};

export type VisualConceptPack = {
  activityId: string;
  title: string;
  format: VisualFormat;
  formats: VisualFormat[];
  facts: VisualFactSlot[];
  missingRequired: string[];
  unknownFields: string[];
  concepts: VisualConcept[];
  styleGuardrails: string[];
  overlayText: Record<OnImageField, string | null>;
  carouselPages: Array<{
    page: number;
    role: "hook" | "story" | "info";
    overlay: Record<string, string | null>;
    note: string;
  }> | null;
  directions: Array<{
    title: string;
    claim: string;
    visual: string;
    composition: string;
    color: string;
    typography: string;
    copy: string;
    cta: string;
    platform: VisualFormatId;
    sources: string[];
    risks: string[];
  }>;
  notice: string;
  rendered: false;
  generatedImage: false;
  executableInCanva: false;
  publish: false;
};

export const SHARED_NEGATIVE_PROMPT = [
  "watercolor",
  "cheap Canva template",
  "wall of text",
  "overly religious imagery",
  "monastery interior",
  "incense smoke filling the frame",
  "mandala wallpaper",
  "gothic church",
  "dark temple",
  "plastic glow",
  "extra fingers",
  "fake stock handshake",
  "neon gradient mesh",
  "drop-shadow wordart",
  "cluttered stickers",
  "AI slop",
];

export const STYLE_GUARDRAILS = [
  "明亮、年輕、校園感。",
  "不過度宗教；禪的感覺用日常物件與光影，不用寺廟香爐當主視覺。",
  "不水彩、不廉價 Canva 模板、不滿版文字。",
  "優先：攝影感、插畫感、3D 小物、空間、校園生活、淡水光影、學生、物件敘事。",
  "imagePrompt 只描述場景，活動文字放 overlay，不把未確認日期地點寫進畫面。",
  "這是規格，不是已出圖，也不是已發佈。",
];

function zone(
  name: string,
  xPct: number,
  yPct: number,
  wPct: number,
  hPct: number,
  note: string,
): PlacementZone {
  return { zone: name, xPct, yPct, wPct, hPct, note };
}

function formatZones(format: VisualFormat): Record<string, PlacementZone> {
  if (format.role === "story" || format.role === "reels_cover")
    return {
      logo: zone("logo", 6, 16, 22, 8, "頭像列下方，勿貼頂。"),
      headline: zone("headline", 8, 22, 84, 16, "短主標，必須落在中央 4:5 內。"),
      subject: zone("subject", 8, 38, 84, 32, "主體置中，避開上下裁切。"),
      info: zone("info", 8, 72, 84, 8, "時間地點；沒有確認值就留空。"),
      cta: zone("cta", 18, 81, 64, 7, "回覆列上方，觸控至少 44px。"),
      qr: zone("qr", 78, 70, 14, 10, "有報名連結才放；沒有則省略。"),
    };
  if (format.role === "poster")
    return {
      logo: zone("logo", 8, 6, 20, 8, "印刷安全區內。"),
      headline: zone("headline", 8, 16, 84, 14, "遠看可讀。"),
      subject: zone("subject", 8, 32, 84, 40, "主視覺留白，不要塞滿文字。"),
      info: zone("info", 8, 76, 54, 12, "日期時間地點；缺值留空。"),
      cta: zone("cta", 8, 88, 40, 6, "一句行動。"),
      qr: zone("qr", 72, 76, 20, 14, "邊長至少 20mm；無報名連結則省略。"),
    };
  return {
    logo: zone("logo", 6, 5, 22, 8, "左上安全區。"),
    headline: zone("headline", 8, 10, 84, 16, "上三分之一。"),
    subject: zone("subject", 6, 28, 88, 46, "生活場景當主視覺。"),
    info: zone("info", 8, 78, 58, 12, "底部資訊列。"),
    cta: zone("cta", 68, 80, 26, 10, "右下行動鈕。"),
    qr: zone("qr", 8, 78, 12, 12, "有報名連結才放。"),
  };
}

const PLACEHOLDER_VALUE =
  /^(待確認|未定|未知|不明|UNKNOWN|NEEDS_VERIFICATION|TBD|TODO|N\/A|待討論|地點待確認|\?+)$/i;

export function usableOnImageValue(value: string | null | undefined) {
  const text = value?.trim() || "";
  return text.length > 0 && !PLACEHOLDER_VALUE.test(text);
}

function pickPublicFact(facts: Fact[], field: OnImageField): Fact | null {
  const matches = facts.filter(
    (item) =>
      item.field === field &&
      item.visibility === "public" &&
      item.state !== "rejected",
  );
  const confirmed = matches.find((item) => item.state === "confirmed");
  if (confirmed) return confirmed;
  const provided = matches.find((item) => item.state === "user_provided");
  if (provided) return provided;
  const pending = matches.find((item) => item.state === "pending");
  return pending || null;
}

function classifyFact(fact: Fact | null): VisualFactSlot["classification"] {
  if (!fact) return "UNKNOWN";
  if (fact.state === "pending") return "NEEDS_VERIFICATION";
  if (fact.sources.length > 0) return "SOURCE_VERIFIED";
  if (fact.state === "confirmed" || fact.state === "user_provided")
    return "USER_PROVIDED";
  return "UNKNOWN";
}

export function visualFactSlots(
  activity: Pick<Activity, "facts">,
): VisualFactSlot[] {
  return ON_IMAGE_FIELDS.map((field) => {
    const fact = pickPublicFact(activity.facts, field);
    const ready =
      (fact?.state === "confirmed" || fact?.state === "user_provided") &&
      usableOnImageValue(fact.value);
    return {
      field,
      label: fieldLabels[field],
      value: ready ? fact!.value : null,
      state: fact?.state || "missing",
      classification:
        fact && !usableOnImageValue(fact.value)
          ? "NEEDS_VERIFICATION"
          : classifyFact(fact),
      onImage: Boolean(ready),
    };
  });
}

function overlayLine(slots: VisualFactSlot[], field: OnImageField) {
  const slot = slots.find((item) => item.field === field);
  return slot?.onImage ? slot.value : null;
}

function overlayCopy(slots: VisualFactSlot[]) {
  return {
    name: overlayLine(slots, "name"),
    date: overlayLine(slots, "date"),
    time: overlayLine(slots, "time"),
    location: overlayLine(slots, "location"),
    registration: overlayLine(slots, "registration"),
  };
}

function scenePrompt(
  kind: VisualConcept["mainSubject"]["kind"],
  confirmedName: string | null,
) {
  const subject = confirmedName
    ? `Campus activity scene for a student club event named 「${confirmedName}」. Do not invent a different event name.`
    : `Campus activity scene for a student club. Event name is unknown — do not invent a title, date, or place as text in the image.`;
  const shared =
    "Bright daylight, youthful Tamkang / Tamsui campus life, real student objects, natural light, photographic color, uncluttered, no wall of text, no watercolor, no cheap template look. Render the scene only; overlay text is added later.";
  if (kind === "photography")
    return `${subject} Concept A, photography: a real-looking student pausing on a sunlit campus slope or riverside path, backpack and sneakers, gentle wind, documentary still. ${shared}`;
  if (kind === "illustration_object")
    return `${subject} Concept B, object narrative: a small 3D/illustrated still-life of a tote, cup, bicycle bell or notebook on a bright desk by a window, tactile materials, shallow depth. ${shared}`;
  return `${subject} Concept C, spatial gathering: a wide 2.5D view of a campus plaza or club booth from behind a few students, airy space, soft shadows, people as backs/silhouettes not fake faces. ${shared}`;
}

const CONCEPT_META: Record<
  VisualConceptId,
  {
    name: string;
    creativeDirection: string;
    kind: VisualConcept["mainSubject"]["kind"];
    background: string;
    subject: string;
    color: string;
    typeHeadline: string;
    typeSub: string;
    typeInfo: string;
    typeCta: string;
    hierarchy: string[];
  }
> = {
  A: {
    name: "攝影感校園生活",
    creativeDirection:
      "用真實光影與學生日常停格，讓人覺得「這是我走路上學會遇見的」。",
    kind: "photography",
    background: "淡水／校園白天自然光，淺天空與斜坡，低對比。",
    subject: "一位學生背影或側臉、背包、球鞋；不是團拍握手。",
    color: "日光白、校園綠、淡水河岸暖灰。",
    typeHeadline: "粗體無襯線，短句，高對比但不要立體字。",
    typeSub: "中等字重，一行副標。",
    typeInfo: "等寬或中性無襯線，資訊列小字。",
    typeCta: "實心圓角按鈕，字少。",
    hierarchy: ["主視覺人物／場景", "短主標", "已確認資訊列", "CTA", "Logo"],
  },
  B: {
    name: "物件敘事",
    creativeDirection:
      "用一杯水、帆布袋、車鈴這類小物件說「來坐一下」，不要講教義。",
    kind: "illustration_object",
    background: "窗邊桌面、乾淨牆面、柔和陰影。",
    subject: "3D 小物或插畫靜物，材質清楚。",
    color: "紙白、木色、一點校園綠。",
    typeHeadline: "稍有個性的無襯線，仍克制。",
    typeSub: "細字重說明物件與活動關係。",
    typeInfo: "底部橫列，不蓋住物件。",
    typeCta: "小膠囊按鈕。",
    hierarchy: ["物件特寫", "短主標", "已確認資訊", "CTA", "Logo"],
  },
  C: {
    name: "空間與聚集",
    creativeDirection:
      "從稍遠的位置看見攤位或廣場，讓內向的人覺得可以先看、再走近。",
    kind: "spatial",
    background: "校園廣場或走廊的空氣感，柔和接觸陰影。",
    subject: "攤位／桌面／幾個人的背影，空間優先於臉。",
    color: "淺石色、樹蔭綠、陽光斑。",
    typeHeadline: "大而少，放在天空或地面留白。",
    typeSub: "一行，說明這是什麼場合。",
    typeInfo: "貼地資訊列。",
    typeCta: "底部寬按鈕。",
    hierarchy: ["空間場景", "短主標", "已確認資訊", "CTA／QR", "Logo"],
  },
};

function typographyFor(format: VisualFormat, meta: (typeof CONCEPT_META)["A"]) {
  const story = format.role === "story" || format.role === "reels_cover";
  const poster = format.role === "poster";
  return {
    headline: meta.typeHeadline,
    subhead: meta.typeSub,
    info: meta.typeInfo,
    cta: meta.typeCta,
    maxHeadlineChars: story ? 16 : poster ? 22 : 18,
    maxBodyChars: story ? 36 : poster ? 80 : 48,
  };
}

export function compileVisualConcepts(
  activity: Pick<Activity, "id" | "title" | "facts">,
  formatId: VisualFormatId = "ig_feed_4x5",
): VisualConceptPack {
  const format = VISUAL_FORMATS[formatId];
  const facts = visualFactSlots(activity);
  const overlay = overlayCopy(facts);
  const unknownFields = facts
    .filter((item) => !item.onImage)
    .map((item) => item.label);
  const missingRequired = facts
    .filter((item) => item.field === "name" || item.field === "date" || item.field === "location")
    .filter((item) => !item.onImage)
    .map((item) => item.label);
  const zones = formatZones(format);
  const includeQr = Boolean(overlay.registration);
  const concepts = VISUAL_CONCEPT_IDS.map((id) => {
    const meta = CONCEPT_META[id];
    const ctaCopy = overlay.registration ? overlay.registration : null;
    return {
      id,
      name: meta.name,
      creativeDirection: meta.creativeDirection,
      layout: {
        formatId: format.id,
        grid: format.compositionHint,
        textCoverageMaxPct: format.textCoverageMaxPct,
        zones,
      },
      typography: typographyFor(format, meta),
      imagePrompt: scenePrompt(meta.kind, overlay.name),
      negativePrompt: SHARED_NEGATIVE_PROMPT,
      background: meta.background,
      mainSubject: {
        kind: meta.kind,
        description: meta.subject,
        classification: "INSPIRATION" as const,
      },
      ctaPlacement: {
        ...zones.cta,
        copy: ctaCopy,
        classification: ctaCopy ? ("USER_PROVIDED" as const) : ("UNKNOWN" as const),
      },
      qrPlacement: {
        ...zones.qr,
        include: includeQr,
        reason: includeQr
          ? "已有公開報名方式，可放 QR；連結仍需人工核對。"
          : "報名方式未確認，省略 QR，不補造網址。",
      },
      logoSafeArea: zones.logo,
      visualHierarchy: meta.hierarchy,
      rendered: false as const,
      generatedImage: false as const,
    } satisfies VisualConcept;
  });
  const directions = concepts.map((concept) => ({
    title: `概念 ${concept.id}｜${concept.name}`,
    claim: concept.creativeDirection,
    visual: concept.imagePrompt,
    composition: format.compositionHint,
    color: CONCEPT_META[concept.id].color,
    typography: concept.typography.headline,
    copy: [
      overlay.name,
      [overlay.date, overlay.time].filter(Boolean).join(" "),
      overlay.location,
    ]
      .filter(Boolean)
      .join("\n"),
    cta: overlay.registration || "",
    platform: format.id,
    sources: activity.facts
      .filter((item) => item.visibility === "public" && item.sources[0]?.url)
      .flatMap((item) => item.sources.map((source) => source.url))
      .slice(0, 20),
    risks: [
      ...unknownFields.map((label) => `${label}未確認，畫面上必須留空。`),
      "尚未出圖；imagePrompt 不是成品。",
      "不得發佈 Instagram。",
    ],
  }));
  return {
    activityId: activity.id,
    title: overlay.name || activity.title,
    format,
    formats: Object.values(VISUAL_FORMATS),
    facts,
    missingRequired,
    unknownFields,
    concepts,
    styleGuardrails: STYLE_GUARDRAILS,
    overlayText: overlay,
    carouselPages:
      format.role === "carousel"
        ? [
            {
              page: 1,
              role: "hook" as const,
              overlay: { name: overlay.name },
              note: "幾乎無字，只放鉤子與主視覺。",
            },
            {
              page: 2,
              role: "story" as const,
              overlay: {},
              note: "只說一件事；不要堆時間地點。",
            },
            {
              page: 3,
              role: "info" as const,
              overlay: {
                date: overlay.date,
                time: overlay.time,
                location: overlay.location,
                registration: overlay.registration,
              },
              note: "最後一頁才放已確認資訊／CTA／QR；缺值留空。",
            },
          ]
        : null,
    directions,
    notice: missingRequired.length
      ? `活動資訊不完整（${missingRequired.join("、")}）。已標 UNKNOWN，沒有補造，也沒有出圖。`
      : "已用公開可上圖欄位編譯三個視覺概念。這不是已出圖，也不是已發佈。",
    rendered: false,
    generatedImage: false,
    executableInCanva: false,
    publish: false,
  };
}
