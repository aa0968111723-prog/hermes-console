import test from "node:test";
import assert from "node:assert/strict";
import {
  isEmptyToolResult,
  studentFacingTask,
  studentHermesError,
  taxonomyFor,
} from "../lib/server/errors";

test("empty tool payloads are not success", () => {
  for (const value of [null, undefined, "", "  ", [], {}, { content: [] }, { result: null }])
    assert.equal(isEmptyToolResult(value), true, String(value));
  assert.equal(isEmptyToolResult({ items: [] }), false);
  assert.equal(isEmptyToolResult({ title: "茶會" }), false);
  assert.equal(isEmptyToolResult("已找到三筆來源"), false);
});

test("error codes collapse into the shared taxonomy", () => {
  assert.equal(taxonomyFor("empty_tool_result"), "TOOL_UNAVAILABLE");
  assert.equal(taxonomyFor("invalid_login"), "AUTH_ERROR");
  assert.equal(taxonomyFor("permission_denied"), "PERMISSION_ERROR");
  assert.equal(taxonomyFor("membership_required"), "PERMISSION_ERROR");
  assert.equal(taxonomyFor("rate_limited"), "RATE_LIMIT");
  assert.equal(taxonomyFor("store_unavailable"), "NETWORK_ERROR");
  assert.equal(taxonomyFor("hermes_unconfigured"), "TOOL_UNAVAILABLE");
  assert.equal(taxonomyFor("hermes_not_ready"), "UPSTREAM_ERROR");
  assert.equal(taxonomyFor("mystery"), "UNKNOWN");
});

test("student Hermes errors never name env vars or keys", () => {
  assert.equal(
    studentHermesError("Hermes 金鑰無效或已撤銷，請在後端更換。", "upstream_401"),
    "現在沒辦法連到 Hermes。",
  );
  assert.equal(
    studentHermesError("尚未在連線設定或後端環境變數提供 HERMES_API_KEY。"),
    "現在沒辦法連到 Hermes。",
  );
  assert.equal(
    studentHermesError("憑證參照無效。", "invalid_credential_ref"),
    "Hermes 還沒準備好。可以先找靈感，或稍後再試。",
  );
  assert.doesNotMatch(
    studentHermesError("憑證參照無效。", "invalid_credential_ref"),
    /設定|連線頁|環境變數|金鑰/,
  );
  assert.equal(
    studentHermesError("Hermes 未產生可顯示的回應。", "empty_output"),
    "Hermes 未產生可顯示的回應。",
  );
  assert.equal(
    studentHermesError("Hermes 回應閒置逾時。", "idle_timeout"),
    "Hermes 回應閒置逾時。",
  );
  assert.equal(
    studentHermesError("Hermes 回應異常，請檢查部署服務。"),
    "現在沒辦法連到 Hermes。",
  );
  assert.equal(
    studentHermesError("Hermes 回報任務失敗；請檢查工具授權與服務日誌。"),
    "現在沒辦法連到 Hermes。",
  );
  assert.equal(
    studentHermesError("圖片已保存，但部署端尚未驗證圖片輸入。請完成設定後重新傳送。", "images_unverified"),
    "圖片已保存，但還沒辦法讀圖。可以先拿掉附件，或改問這張哪裡可以改。",
  );
  assert.equal(
    studentHermesError(
      "任務輸入估計 15613 tokens，超過上限 12000。已裁切歷史與指示後仍超限，請開新對話或縮短內容。",
      "token_budget_exceeded",
    ),
    "這次內容太長。請開新對話再試一次。",
  );
  assert.doesNotMatch(
    studentHermesError(
      "任務輸入估計 15613 tokens，超過上限 12000。已裁切歷史與指示後仍超限，請開新對話或縮短內容。",
    ),
    /tokens|12000|15613/,
  );
});

test("studentFacingTask rewrites stored 服務日誌 and token-budget rows", () => {
  const storedLog = "Hermes 回報任務失敗；請檢查工具授權與服務日誌。";
  const storedTokens =
    "任務輸入估計 15613 tokens，超過上限 12000。已裁切歷史與指示後仍超限，請開新對話或縮短內容。";
  const honest = "工作區社團索引沒有誠實標示快照；沒有用假資料補上。";
  const shown = studentFacingTask({
    error: storedLog,
    observationError: storedTokens,
    events: [
      {
        error: storedLog,
        summary: storedLog,
      },
      {
        error: storedTokens,
        summary: storedTokens,
      },
      {
        error: null,
        summary: honest,
      },
    ],
  });
  assert.equal(shown.error, "現在沒辦法連到 Hermes。");
  assert.equal(shown.observationError, "這次內容太長。請開新對話再試一次。");
  assert.equal(shown.events[0].error, "現在沒辦法連到 Hermes。");
  assert.equal(shown.events[0].summary, "現在沒辦法連到 Hermes。");
  assert.equal(shown.events[1].error, "這次內容太長。請開新對話再試一次。");
  assert.equal(shown.events[1].summary, "這次內容太長。請開新對話再試一次。");
  assert.equal(shown.events[2].summary, honest);
  assert.doesNotMatch(JSON.stringify(shown), /服務日誌|工具授權|15613|12000|tokens/);
});
