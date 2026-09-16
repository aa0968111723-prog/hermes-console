import test from "node:test";
import assert from "node:assert/strict";
import {
  liveTaskCovered,
  visibleChatMessages,
} from "../lib/client/chat-thread";
import type { Message, Task } from "../lib/contracts";

const task = {
  id: "task-1",
  output: "Hermes Agent 尚未連線，沒有上網搜尋。",
} as Task;

test("visible chat messages keep one assistant when task and content match twice", () => {
  const messages: Message[] = [
    {
      id: "u1",
      role: "user",
      content: "茶會",
      createdAt: "2026-01-01T00:00:00.000Z",
      taskId: "task-1",
    },
    {
      id: "a1",
      role: "assistant",
      content: task.output,
      createdAt: "2026-01-01T00:00:01.000Z",
      taskId: "task-1",
      provenance: "workspace",
    },
    {
      id: "a2",
      role: "assistant",
      content: task.output,
      createdAt: "2026-01-01T00:00:02.000Z",
      taskId: "task-1",
      provenance: "workspace",
    },
  ];
  const visible = visibleChatMessages(messages);
  assert.equal(visible.length, 2);
  assert.equal(visible.filter((m) => m.role === "assistant").length, 1);
});

test("live task pane is covered by saved assistant content even without taskId", () => {
  const messages: Message[] = [
    {
      id: "a1",
      role: "assistant",
      content: task.output,
      createdAt: "2026-01-01T00:00:01.000Z",
      provenance: "workspace",
    },
  ];
  assert.equal(liveTaskCovered(messages, task), true);
  assert.equal(liveTaskCovered([], task), false);
});
