import test from "node:test";
import assert from "node:assert/strict";
import type { Conversation, Task } from "../lib/contracts";
import {
  EMPTY_WORKSPACE,
  WORKSPACE_LOAD_NOTICE,
  conversationWithTaskMessages,
  isAbortLike,
  mergeTasks,
  mergeWorkspaceSnapshot,
  readWorkspaceSnapshot,
  studentSafeApiMessage,
  shouldShowWorkspaceLoadNotice,
  studentNoticeBarText,
  upsertConversation,
} from "../lib/client/workspace-state";

const conversation = (
  id: string,
  messages: Conversation["messages"] = [],
): Conversation => ({
  id,
  title: "茶會",
  projectId: "personal",
  messages,
  hermesSessionId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("invalid workspace GET bodies are rejected instead of wiping chat", () => {
  assert.equal(readWorkspaceSnapshot(null), null);
  assert.equal(readWorkspaceSnapshot({}), null);
  assert.equal(readWorkspaceSnapshot({ conversations: [] }), null);
  assert.equal(readWorkspaceSnapshot("not-json"), null);
  const snap = readWorkspaceSnapshot({
    conversations: [{ id: "c1", title: "茶會", projectId: "personal", messages: null }],
    projects: [{ id: "personal", name: "個人工作區" }],
    materials: [],
  });
  assert.ok(snap);
  assert.equal(snap.conversations[0].messages.length, 0);
});

test("failed or stale refresh keeps the richer open conversation", () => {
  const previous = {
    ...EMPTY_WORKSPACE,
    conversations: [
      conversation("open", [
        {
          id: "u1",
          role: "user",
          content: "幫我找淡大禪學社茶會宣傳靈感",
          createdAt: "2026-01-01T00:00:00.000Z",
          taskId: "t1",
        },
        {
          id: "a1",
          role: "assistant",
          content: "已從工作區整理方向",
          createdAt: "2026-01-01T00:00:01.000Z",
          taskId: "t1",
          provenance: "workspace",
        },
      ]),
    ],
  };
  const emptyIncoming = mergeWorkspaceSnapshot(previous, {
    ...EMPTY_WORKSPACE,
    conversations: [],
  });
  assert.equal(emptyIncoming.conversations[0].messages.length, 2);
  const staleIncoming = mergeWorkspaceSnapshot(previous, {
    ...EMPTY_WORKSPACE,
    conversations: [conversation("open", [])],
  });
  assert.equal(staleIncoming.conversations[0].messages.length, 2);
});

test("empty degraded task list does not drop local tasks", () => {
  const local = [{ id: "t1", events: [{ id: "e1" }] }] as unknown as Task[];
  assert.equal(mergeTasks(local, []).length, 1);
  assert.equal(mergeTasks(local, undefined).length, 1);
  const merged = mergeTasks(local, [
    { id: "t1", events: [] },
    { id: "t2", events: [{ id: "e2" }] },
  ] as unknown as Task[]);
  assert.equal(merged.find((item) => item.id === "t1")?.events.length, 1);
  assert.ok(merged.some((item) => item.id === "t2"));
});

test("local-fulfilled task keeps messages when workspace GET never returns", () => {
  const conv = conversation("c1");
  const task = {
    id: "t1",
    input: "幫我找淡大禪學社茶會宣傳靈感",
    output: "已從工作區整理創作方向",
    state: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
    events: [{ toolName: "workspace_search_inspiration" }],
  } as unknown as Task;
  const next = conversationWithTaskMessages(conv, task, []);
  assert.equal(next.messages.length, 2);
  assert.equal(next.messages[0].role, "user");
  assert.equal(next.messages[1].provenance, "workspace");
  const again = conversationWithTaskMessages(next, task, []);
  assert.equal(again.messages.length, 2);
});

test("student-safe workspace notice never echoes secrets", () => {
  assert.equal(
    studentSafeApiMessage(
      "Bearer sk-live-secret postgres://user:pass@host/db HERMES_API_KEY=secret",
    ),
    WORKSPACE_LOAD_NOTICE,
  );
  assert.match(WORKSPACE_LOAD_NOTICE, /連線未確認時仍可使用此工作區/);
  assert.doesNotMatch(WORKSPACE_LOAD_NOTICE, /Bearer |sk-|postgres/i);
  assert.equal(
    studentSafeApiMessage("請稍後再試，請求次數已達限制。"),
    "請稍後再試，請求次數已達限制。",
  );
  assert.equal(
    studentNoticeBarText(
      WORKSPACE_LOAD_NOTICE,
      "Hermes 尚未連線，沒有出圖。",
      true,
      "離線 · 顯示上次資料。",
    ),
    WORKSPACE_LOAD_NOTICE,
  );
  assert.equal(
    studentNoticeBarText("", "Hermes 尚未連線，沒有出圖。", true, "離線 · 顯示上次資料。"),
    "Hermes 尚未連線，沒有出圖。",
  );
  assert.equal(
    studentNoticeBarText("", "", true, "離線 · 顯示上次資料。"),
    "離線 · 顯示上次資料。",
  );
  assert.equal(shouldShowWorkspaceLoadNotice(false), true);
  assert.equal(shouldShowWorkspaceLoadNotice(true), false);
});

test("aborted fetches are not treated as a fatal empty workspace", () => {
  const abort = new Error("The operation was aborted");
  abort.name = "AbortError";
  assert.equal(isAbortLike(abort), true);
  const timeout = new Error("timeout");
  timeout.name = "TimeoutError";
  assert.equal(isAbortLike(timeout), true);
  assert.equal(isAbortLike(new Error("儲存庫無法使用。")), false);
});

test("upsert keeps the open conversation first without dropping others", () => {
  const listed = upsertConversation(
    [conversation("old")],
    conversation("open", [
      {
        id: "u1",
        role: "user",
        content: "問",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
  );
  assert.equal(listed[0].id, "open");
  assert.equal(listed.length, 2);
});
