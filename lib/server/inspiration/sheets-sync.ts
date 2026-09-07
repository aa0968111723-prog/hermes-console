import { ingestUrl, listInspiration, type InspirationItem } from "../inspiration";
import { get, put, transaction } from "../store";
import { canonicalUrl } from "./dedupe";
import { WORKSPACE_OWNER, redact } from "../security";

export type SheetSyncResult = {
  startedAt: string;
  finishedAt: string;
  read: number;
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
};

type SheetSource = {
  id: string;
  projectId: string;
  label: string;
  accept: RegExp;
  caption: (cells: string[]) => string;
};

const SHEETS: SheetSource[] = [
  {
    id: "1JVM0trGOeS49Sjjg3BoaKnS1Z0lT0hoWT5dCRsD97bs",
    projectId: "tamkang",
    label: "淡江新生需求表",
    accept: /^TKU-\d+$/i,
    caption: (cells) =>
      compact(
        [cells[0], cells[1], cells[2], cells[6], cells[7]].filter(Boolean).join(" · "),
      ),
  },
  {
    id: "1YXefcEEMbNEdttqWIZLUXSLKrkF75kf-4DcYFiTiCOA",
    projectId: "campaigns",
    label: "網宣設計資料庫",
    accept: /^POST-\d+$/i,
    caption: (cells) =>
      compact(
        [cells[0], cells[1], cells[2], cells[5], cells[8]].filter(Boolean).join(" · "),
      ),
  },
  {
    id: "1lPJS6WMzuw37U6hML5A6K2gPKkUNJH4SLa5Numis0Ow",
    projectId: "console",
    label: "Hermes 整合研究",
    accept: /^GAP-\d+$/i,
    caption: (cells) => compact(cells.filter(Boolean).slice(0, 6).join(" · ")),
  },
  {
    id: "107YsDhEz8A2t3h9Y-WL4N7VzLt6gyaKSqIeTNLDFakc",
    projectId: "zen-club",
    label: "社課知識庫",
    accept: /^KP-\d+$/i,
    caption: (cells) =>
      compact(
        [cells[0], cells[1], cells[2], cells[3], cells[4]].filter(Boolean).join(" · "),
      ),
  },
];

let inflight: Promise<SheetSyncResult> | null = null;
export function sheetsSyncStatus() {
  return get<SheetSyncResult & { id: string }>("sheet_sync", WORKSPACE_OWNER, "latest");
}

// Explicit authenticated POST only; concurrent requests share the operation.
export function syncSheetsInspiration(): Promise<SheetSyncResult> {
  if (inflight) return inflight;
  inflight = runSync().finally(() => { inflight = null; });
  return inflight;
}

async function runSync(): Promise<SheetSyncResult> {
  const startedAt = new Date().toISOString();
  const results = await Promise.all(SHEETS.map(async sheet => {
    const result = { read: 0, created: 0, skipped: 0, failed: 0, errors: [] as string[] };
    try {
      const rows = await fetchSheetRows(sheet.id);
      for (const [index, cells] of rows.entries()) {
        const rowId = (cells[0] || "").trim();
        if (!sheet.accept.test(rowId)) continue;
        result.read++;
        // Stable row identity, not a Google Sheets cell anchor; opens the source sheet.
        const sourceUrl = "https://docs.google.com/spreadsheets/d/" + sheet.id +
          "/edit?usp=sharing&row=" + encodeURIComponent(rowId);
        try {
          transaction(() => {
            if (listInspiration(sheet.projectId).some(item =>
              canonicalUrl(item.sourceUrl) === canonicalUrl(sourceUrl))) {
              result.skipped++;
              return;
            }
            const caption = sheet.caption(cells);
            if (redact(caption) !== caption) throw new Error("sensitive_content");
            if (!get("project", WORKSPACE_OWNER, sheet.projectId))
              put("project", WORKSPACE_OWNER, {
                id: sheet.projectId, name: sheet.label, createdAt: new Date().toISOString(),
              });
            const item = ingestUrl({
              url: sourceUrl, projectId: sheet.projectId, account: rowId, caption,
            });
            const saved: InspirationItem = {
              ...item, sourceType: "public_index",
              analysis: "已讀取試算表文字摘要：" + caption,
              borrow: [],
              fit: "僅匯入文字，尚未分析圖片或核對活動資訊；來源連結開啟原始試算表。",
              risk: "參考資料不代表已確認可公開使用；私人校務資訊不得自動加入文宣。",
            };
            put("inspiration", WORKSPACE_OWNER, saved);
            result.created++;
          });
        } catch {
          result.failed++;
          result.errors.push(sheet.label + " 第 " + (index + 1) + " 列：匯入失敗，請檢查欄位或敏感資訊。");
        }
      }
    } catch (error) {
      result.failed++;
      result.errors.push(sheet.label + "：" +
        (error instanceof SheetFetchError ? error.message :
          error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
            ? "csv_timeout" : "network_error"));
    }
    return result;
  }));
  const result: SheetSyncResult = {
    read: 0, created: 0, skipped: 0, failed: 0, errors: [],
    startedAt, finishedAt: new Date().toISOString(),
  };
  for (const item of results) {
    result.read += item.read; result.created += item.created;
    result.skipped += item.skipped; result.failed += item.failed;
    result.errors.push(...item.errors);
  }
  put("sheet_sync", WORKSPACE_OWNER, { id: "latest", ...result });
  return result;
}

class SheetFetchError extends Error {}
async function fetchSheetRows(fileId: string): Promise<string[][]> {
  let url = new URL("https://docs.google.com/spreadsheets/d/" + fileId + "/export?format=csv");
  const signal = AbortSignal.timeout(20_000);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") ||
        !(url.hostname === "docs.google.com" || url.hostname.endsWith(".googleusercontent.com")))
      throw new SheetFetchError("redirect_blocked");
    const response = await fetch(url, { cache: "no-store", redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new SheetFetchError("redirect_missing");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SheetFetchError("csv_http_" + response.status);
    }
    if (!response.body) throw new SheetFetchError("csv_empty");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new SheetFetchError("csv_too_large");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel(); }
    if (/<!DOCTYPE html|<html/i.test(text.slice(0, 200)))
      throw new SheetFetchError("csv_not_public");
    return parseCsv(text);
  }
  throw new SheetFetchError("too_many_redirects");
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const endField = () => { row.push(field); field = ""; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += ch;
      continue;
    }
    if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endField(); rows.push(row); row = [];
    } else if (ch === '"' && !field && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw new SheetFetchError("csv_malformed");
      field += ch;
    }
  }
  if (quoted) throw new SheetFetchError("csv_unterminated_quote");
  if (field || row.length || closed) { endField(); rows.push(row); }
  return rows;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}
