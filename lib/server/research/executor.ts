import { randomUUID } from "node:crypto";
import type { ResearchBundle, ResearchClaim, ResearchSourceRecord } from "../../contracts";

const OFFICIAL_HOSTS = new Set([
  "www.tku.edu.tw",
  "www.edpsy.tku.edu.tw",
  "law.moj.gov.tw",
]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function allowed(url: URL) {
  if (url.protocol === "https:" && OFFICIAL_HOSTS.has(url.hostname) && !url.username && !url.password)
    return true;
  return (
    process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" &&
    LOOPBACK.has(url.hostname) &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password
  );
}

function shouldFetchLive(url: URL) {
  if (!allowed(url)) return false;
  if (LOOPBACK.has(url.hostname)) return true;
  // Contract tests set loopback HTTP; do not hit the public internet there.
  return process.env.HERMES_ALLOW_LOOPBACK_HTTP !== "true";
}

function excerptFrom(html: string) {
  const title = html.match(/<title[^>]*>([^<]{1,200})/i)?.[1]?.replace(/\s+/g, " ").trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return { title: title || "", text };
}

export async function retrieveSource(
  record: ResearchSourceRecord,
  fetchImpl: typeof fetch = fetch,
): Promise<ResearchSourceRecord> {
  let url: URL;
  try {
    url = new URL(record.url);
  } catch {
    return { ...record, verification: "failed", retrievedAt: null };
  }
  if (!shouldFetchLive(url)) {
    return { ...record, verification: "not_fetched" };
  }
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "text/html,text/plain" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ...record, verification: "failed", retrievedAt: null };
    }
    const html = (await response.text()).slice(0, 200_000);
    const extracted = excerptFrom(html);
    if (!extracted.text) {
      return { ...record, verification: "failed", retrievedAt: null };
    }
    return {
      ...record,
      title: extracted.title || record.title,
      excerpt: extracted.text,
      retrievedAt: new Date().toISOString(),
      verification: "fetched",
      publisher: url.hostname,
      type: "official_web",
      authority: "official",
      confidence: 0.6,
    };
  } catch {
    return { ...record, verification: "failed", retrievedAt: null };
  }
}

export async function executeResearchBundle(
  bundle: ResearchBundle,
  fetchImpl: typeof fetch = fetch,
): Promise<ResearchBundle> {
  const directory = bundle.sourceDirectory || [];
  if (!directory.length) {
    return {
      ...bundle,
      executed: false,
      sources: [],
      claims: [],
      message: "沒有可抓取的來源目錄；研究仍是未執行的計畫。",
    };
  }
  const sources: ResearchSourceRecord[] = [];
  for (const entry of directory.slice(0, 6)) {
    sources.push(await retrieveSource(entry, fetchImpl));
  }
  const fetched = sources.filter((item) => item.verification === "fetched" && item.retrievedAt);
  const claims: ResearchClaim[] = fetched.map((item) => ({
    id: randomUUID(),
    statement: "已讀取官方頁面「" + item.title + "」。這不是市場調查或完整文獻回顧。",
    sourceIds: [item.id],
    confidence: 0.6,
    verification: "source_verified",
    truth: "SOURCE_VERIFIED",
  }));
  if (!fetched.length) {
    return {
      ...bundle,
      executed: false,
      sources,
      claims: [],
      message:
        "尚未取得外部 evidence；不得把計畫當成已完成研究，也不會用模型自行補資料。",
    };
  }
  return {
    ...bundle,
    executed: true,
    sources: fetched,
    claims,
    message:
      "已抓取 " +
      fetched.length +
      " 個官方頁面作為來源證據。主張僅限於頁面可讀取，不是民調或完整文獻檢索。",
  };
}
