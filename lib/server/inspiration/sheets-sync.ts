import { ingestUrl, listInspiration, type InspirationItem } from "../inspiration";
import { put } from "../store";
import { WORKSPACE_OWNER } from "../security";

export type SheetSyncResult = {
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

const QUOTE = String.fromCharCode(34);

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
let lastSyncAt = 0;
const COOLDOWN_MS = 10 * 60 * 1000;

export function syncSheetsInspiration(): Promise<SheetSyncResult> {
  const now = Date.now();
  if (inflight) return inflight;
  if (now - lastSyncAt < COOLDOWN_MS) {
    return Promise.resolve({
      read: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    });
  }
  inflight = runSync()
    .then((result) => {
      lastSyncAt = Date.now();
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function runSync(): Promise<SheetSyncResult> {
  const result: SheetSyncResult = {
    read: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  const existing = listInspiration();
  const seen = new Set(
    existing.flatMap((item) => [item.sourceUrl, item.account || ""]).filter(Boolean),
  );

  for (const sheet of SHEETS) {
    try {
      const rows = await fetchSheetRows(sheet.id);
      for (const cells of rows) {
        const rowId = (cells[0] || "").trim();
        if (!sheet.accept.test(rowId)) continue;
        result.read += 1;
        const sourceUrl =
          "https://docs.google.com/spreadsheets/d/" +
          sheet.id +
          "/edit?usp=sharing&row=" +
          encodeURIComponent(rowId);
        if (seen.has(sourceUrl) || seen.has(rowId)) {
          result.skipped += 1;
          continue;
        }
        try {
          const item = ingestUrl({
            url: sourceUrl,
            projectId: sheet.projectId,
            account: rowId,
            caption: sheet.caption(cells),
            sourceType: "public_index",
          });
          const saved: InspirationItem = {
            ...item,
            analysis: sheet.caption(cells),
            borrow: [sheet.label, cells[1] || "試算表列"].filter(Boolean),
            fit: "來自公開試算表的靈感卡，可借鑒結構不可原樣複製。",
            risk: "參考素材不代表可用於正式發佈。",
          };
          put("inspiration", WORKSPACE_OWNER, saved);
          seen.add(sourceUrl);
          seen.add(rowId);
          result.created += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push(
            rowId + ": " + (error instanceof Error ? error.message : "ingest_failed"),
          );
        }
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        sheet.label + ": " + (error instanceof Error ? error.message : "fetch_failed"),
      );
    }
  }
  return result;
}

async function fetchSheetRows(fileId: string): Promise<string[][]> {
  const url =
    "https://docs.google.com/spreadsheets/d/" + fileId + "/export?format=csv";
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("csv_http_" + response.status);
  const text = await response.text();
  if (/<!DOCTYPE html|<html/i.test(text.slice(0, 200)))
    throw new Error("csv_not_public");
  return parseCsv(text);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === QUOTE) {
        if (text[i + 1] === QUOTE) {
          field += QUOTE;
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === QUOTE) quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}
