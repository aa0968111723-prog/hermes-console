export interface InspirationQuery {
  raw: string;
  primary: string;
  visual: string;
  audience: string;
  platform: string;
  negative: string[];
  target: string | null;
  tone: string[];
}

const NEGATIVE: Array<[RegExp, string]> = [
  [/不要太宗教|別太宗教|不像宣教|不要一眼很宗教/i, "religious advertising"],
  [/不要企業|不要太正式|不要講座/i, "corporate"],
  [/不要說教|不要訓話/i, "formal lecture"],
];

export function parseInspirationQuery(raw: string): InspirationQuery {
  const negative: string[] = [];
  for (const [pattern, label] of NEGATIVE)
    if (pattern.test(raw)) negative.push(label);
  const target = /淡江/.test(raw)
    ? "Tamkang freshman"
    : /台大/.test(raw)
      ? "NTU freshman"
      : /新生/.test(raw)
        ? "university freshman"
        : null;
  const tone = [
    /青春|年輕/.test(raw) && "youthful",
    /友善|溫暖|親切/.test(raw) && "friendly",
    /生活|校園|社團/.test(raw) && "student-life",
  ].filter(Boolean) as string[];
  const primary = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    raw,
    primary,
    visual: [target, ...tone, "poster", "campus"].filter(Boolean).join(" "),
    audience: target || "unspecified audience",
    platform: /IG|Instagram/.test(raw)
      ? "instagram"
      : /Pinterest/.test(raw)
        ? "pinterest"
        : "auto",
    negative,
    target,
    tone,
  };
}
