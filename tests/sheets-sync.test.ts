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
const { parseCsv, syncSheetsInspiration, sheetsSyncStatus } = await import("../lib/server/inspiration/sheets-sync");
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
  const prefixes = ["TKU", "POST", "GAP", "KP"];
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
    return new Response(prefixes[index] + '-1,"文字,摘要",未核對日期');
  };
  try {
    const response = await POST(request({ action: "sync_sheets" }));
    const first = (await response.json()).sheetsSync;
    assert.equal(first.created, 3);
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
    assert.equal(second.skipped, 3);
    assert.equal(second.failed, 0);
    assert.equal(calls, 8);
    assert.equal(listInspiration().length, 4);
    assert.equal(listInspiration("tamkang")[0].analysis, "使用者修改保留");
    const status = (await (await GET(request())).json()).sheetsSync;
    assert.equal(status.created, 1);
    assert.equal(calls, 8, "GET never silently resynchronizes");
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
    assert.equal(blocked.failed, 4);
    assert.equal(calls, 4);
    assert.ok(blocked.errors.every(error => error.endsWith("redirect_blocked")));
    globalThis.fetch = async () => new Response("x".repeat(2 * 1024 * 1024 + 1));
    assert.ok((await syncSheetsInspiration()).errors.every(error => error.endsWith("csv_too_large")));
    globalThis.fetch = async () => new Response("<!DOCTYPE html><html>sign in</html>");
    assert.ok((await syncSheetsInspiration()).errors.every(error => error.endsWith("csv_not_public")));
    globalThis.fetch = async () => { throw new DOMException("upstream deadline", "TimeoutError"); };
    assert.ok((await syncSheetsInspiration()).errors.every(error => error.endsWith("csv_timeout")));
    assert.equal(listInspiration().length, 4);
  } finally { globalThis.fetch = original; }
});
