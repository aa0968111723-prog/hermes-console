import type { QaSourceKind } from "./types";

const DRIVE_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "sheets.google.com",
  "slides.google.com",
  "forms.gle",
]);

const TKU_HOSTS = new Set([
  "www.tku.edu.tw",
  "tku.edu.tw",
  "www.edpsy.tku.edu.tw",
  "club.tku.edu.tw",
  "life.tku.edu.tw",
  "tku.miraheze.org",
]);

const IG_HOSTS = new Set(["www.instagram.com", "instagram.com"]);

const RANK: Record<QaSourceKind, number> = {
  drive: 4,
  tku_official: 3,
  instagram: 2,
  other: 1,
  none: 0,
};

export function classifySourceUrl(raw: string): QaSourceKind {
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return "none";
  }
  if (DRIVE_HOSTS.has(host) || host.endsWith(".google.com")) return "drive";
  if (TKU_HOSTS.has(host) || host.endsWith(".tku.edu.tw")) return "tku_official";
  if (IG_HOSTS.has(host)) return "instagram";
  if (host) return "other";
  return "none";
}

export function strongestSourceKind(urls: string[]): QaSourceKind {
  let best: QaSourceKind = "none";
  for (const url of urls) {
    const kind = classifySourceUrl(url);
    if (RANK[kind] > RANK[best]) best = kind;
  }
  return best;
}

/** Instagram is brand evidence, not an internal fact source. */
export function claimStatusCeiling(kind: QaSourceKind): "VERIFIED" | "LIKELY" {
  if (kind === "drive" || kind === "tku_official") return "VERIFIED";
  return "LIKELY";
}
