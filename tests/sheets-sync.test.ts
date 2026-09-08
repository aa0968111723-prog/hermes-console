import test from "node:test";
import { seedSession } from "./session-fixture";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-sheets-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.CONSOLE_GATEWAY_SECRET = randomBytes(32).toString("hex");
const { GET, POST } = await import("../app/api/inspiration/route");
const { parseCsv, syncSheetsInspiration, sheetsSyncStatus, SHEETS } = await import("../lib/server/inspiration/sheets-sync");
const { listInspiration } = await import("../lib/server/inspiration");
const { put } = await import("../lib/server/store");
const request = (body?: unknown, authorized = true) => new Request("https://console.example/api/inspiration", {
  method: body === undefined ? "GET" : "POST",
  headers: {
    Cookie: seedSession().cookie,
    Origin: "https://console.example", "Content-Type": "application/json",
    "X-Console-Gateway": authorized ? process.env.CONSOLE_GATEWAY_SECRET! : "wrong",
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

function sheetByProject(projectId: string) {
  const sheet = SHEETS.find((item) => item.projectId === projectId);
  assert.ok(sheet, projectId);
  return sheet;
}

test("CSV handles BOM, quoted commas/newlines/quotes and rejects malformed input", () => {
  assert.deepEqual(parseCsv('\uFEFFid,text\r\nTKU-1,"a,b\n""quote"""\r\n'), [
    ["id", "text"], ["TKU-1", 'a,b\n"quote"'],
  ]);
  assert.deepEqual(parseCsv('""'), [[""]]);
  assert.deepEqual(parseCsv("a,b,"), [["a", "b", ""]]);
  assert.throws(() => parseCsv('"unterminated'), /unterminated/);
  assert.throws(() => parseCsv('"a"x'), /malformed/);
});

test("opening inspiration is read-only and unauthenticated import never fetches", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected external request"); };
  try {
    assert.equal((await GET(request())).status, 200);
    assert.equal((await POST(request({ action: "sync_sheets" }, false))).status, 401);
    assert.equal(calls, 0);
    assert.equal(sheetsSyncStatus(), null);
    assert.equal(listInspiration().length, 0);
  } finally { globalThis.fetch = original; }
});

test("explicit import persists text and projects, continues after 403, retries without overwriting", async () => {
  const original = globalThis.fetch;
  const ids = new Map<string, number>();
  const rowIds = ["TKU-1", "POST-1", "GAP-1", "KP-1", "1001", "PAP-1"];
  let denied = true, calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = String(input);
    assert.ok(url.startsWith("https://docs.google.com/spreadsheets/d/"));
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.headers, undefined);
    if (!ids.has(url)) ids.set(url, ids.size);
    const index = ids.get(url)!;
    if (index === 1 && denied) return new Response("private", { status: 403 });
    return new Response(rowIds[index] + ',"文字,摘要",未核對日期');
  };
  try {
    const response = await POST(request({ action: "sync_sheets" }));
    const first = (await response.json()).sheetsSync;
    assert.equal(first.created, 5);
    assert.equal(first.failed, 1);
    assert.match(first.errors[0], /csv_http_403/);
    assert.ok(first.finishedAt);
    const saved = listInspiration("tamkang")[0];
    assert.equal(saved.sourceType, "public_index");
    assert.equal(saved.image, null);
    assert.match(saved.analysis, /文字,摘要/);
    put("inspiration", "workspace", { ...saved, analysis: "使用者修改保留" });
    denied = false;
    const a = syncSheetsInspiration(), b = syncSheetsInspiration();
    assert.equal(a, b, "concurrent submissions share one operation");
    const second = await a;
    assert.equal(second.created, 1);
    assert.equal(second.skipped, 5);
    assert.equal(second.failed, 0);
    assert.equal(calls, 12);
    assert.equal(listInspiration().length, 6);
    assert.equal(listInspiration("tamkang")[0].analysis, "使用者修改保留");
    const status = (await (await GET(request())).json()).sheetsSync;
    assert.equal(status.created, 1);
    assert.equal(calls, 12, "GET never silently resynchronizes");
  } finally { globalThis.fetch = original; }
});

test("sheet redirects cannot reach arbitrary targets and oversized or HTML responses fail", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    };
    const blocked = await syncSheetsInspiration();
    assert.equal(blocked.failed, 6);
    assert.equal(calls, 6);
    assert.ok(blocked.errors.every(error => error.endsWith("redirect_blocked")));
    globalThis.fetch = async () => new Response("x".repeat(2 * 1024 * 1024 + 1));
    assert.ok((await syncSheetsInspiration()).errors.every(error => error.endsWith("csv_too_large")));
    globalThis.fetch = async () => new Response("<!DOCTYPE html><html>sign in</html>");
    assert.ok((await syncSheetsInspiration()).errors.every(error => error.endsWith("csv_not_public")));
    globalThis.fetch = async () => { throw new DOMException("upstream deadline", "TimeoutError"); };
    assert.ok((await syncSheetsInspiration()).errors.every(error => error.endsWith("csv_timeout")));
    assert.equal(listInspiration().length, 6);
  } finally { globalThis.fetch = original; }
});

test("campus-clubs and zen-papers accept only matching row ids and pick caption columns", () => {
  assert.equal(SHEETS.length, 6);
  assert.deepEqual(SHEETS.slice(0, 4).map((sheet) => sheet.projectId), [
    "tamkang", "campaigns", "console", "zen-club",
  ]);
  const campus = sheetByProject("campus-clubs");
  const zen = sheetByProject("zen-papers");
  assert.equal(campus.id, "1AqDu7nP_CCPRFIyedPIL94w_N-9RQI12JIfNhZRkjTo");
  assert.equal(zen.id, "1LhZSQMb70ho4O22GHQeMWAI2FkHfkxxsyhbn-iEpvUk");

  assert.equal(campus.accept.test("2026"), true);
  assert.equal(campus.accept.test("0"), true);
  assert.equal(campus.accept.test("TKU-1"), false);
  assert.equal(campus.accept.test("PAP-1"), false);
  assert.equal(campus.accept.test("12a"), false);
  assert.equal(campus.accept.test(""), false);

  assert.equal(zen.accept.test("PAP-1"), true);
  assert.equal(zen.accept.test("pap-99"), true);
  assert.equal(zen.accept.test("2026"), false);
  assert.equal(zen.accept.test("KP-1"), false);
  assert.equal(zen.accept.test("PAP-"), false);
  assert.equal(zen.accept.test("POST-1"), false);

  assert.equal(
    campus.caption(["id", "a", "b", "c", "SKIP", "e", "f"]),
    "id · a · b · c · e",
  );
  assert.equal(
    zen.caption(["id", "a", "b", "s3", "s4", "e", "s6", "s7", "i", "extra"]),
    "id · a · b · e · i",
  );
});

test("sheet row import includes redacted thrown boom in errors", async () => {
  const original = globalThis.fetch;
  const sheet = SHEETS[0];
  const originalCaption = sheet.caption;
  sheet.caption = () => {
    throw new Error("boom");
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(sheet.id)) return new Response("TKU-999,文字,摘要");
    return new Response("id,text\nSKIP-1,no");
  };
  try {
    const result = await syncSheetsInspiration();
    assert.ok(result.failed >= 1);
    assert.ok(
      result.errors.some(
        (error) => error.includes("boom") && error.includes("敏感資訊"),
      ),
      result.errors.join(" | "),
    );
  } finally {
    sheet.caption = originalCaption;
    globalThis.fetch = original;
  }
});

test("campus-clubs and zen-papers skip unmatched rows and rematch on re-sync", async () => {
  const original = globalThis.fetch;
  const campusId = "1AqDu7nP_CCPRFIyedPIL94w_N-9RQI12JIfNhZRkjTo";
  const zenId = "1LhZSQMb70ho4O22GHQeMWAI2FkHfkxxsyhbn-iEpvUk";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(campusId)) {
      return new Response([
        "2026,標題,副標,社團,略過欄,活動",
        "not-id,x,x,x,x,x",
        "TKU-1,x,x,x,x,x",
        "3344,二,欄,值,略過,尾",
      ].join("\n"));
    }
    if (url.includes(zenId)) {
      return new Response([
        "PAP-88,題目,作者,略3,略4,摘要,略6,略7,卷期",
        "pap-99,題2,作者2,x,x,摘2,x,x,卷2",
        "123,x,x,x,x,x,x,x,x",
        "KP-1,x,x,x,x,x,x,x,x",
        "PAP-,x,x,x,x,x,x,x,x",
      ].join("\n"));
    }
    return new Response("id,text\nSKIP-1,no");
  };
  try {
    const first = await syncSheetsInspiration();
    assert.equal(first.read, 4);
    assert.equal(first.created, 4);
    const campus = listInspiration("campus-clubs");
    const importedCampus = campus.find((item) => item.account === "2026");
    assert.ok(importedCampus);
    assert.match(importedCampus.analysis, /2026 · 標題 · 副標 · 社團 · 活動/);
    assert.equal(/略過欄/.test(importedCampus.analysis), false);
    assert.equal(campus.some((item) => item.account === "not-id" || item.account === "TKU-1"), false);
    const zen = listInspiration("zen-papers");
    const importedZen = zen.find((item) => item.account === "PAP-88");
    assert.ok(importedZen);
    assert.match(importedZen.analysis, /PAP-88 · 題目 · 作者 · 摘要 · 卷期/);
    assert.equal(/略3/.test(importedZen.analysis), false);
    assert.equal(zen.some((item) => item.account === "123" || item.account === "KP-1"), false);
    const second = await syncSheetsInspiration();
    assert.equal(second.created, 0);
    assert.equal(second.skipped, 4);
    assert.equal(second.read, 4);
  } finally { globalThis.fetch = original; }
});
