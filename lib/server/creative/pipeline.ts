import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, hash, redact } from "../security";
import { get, put, transaction } from "../store";
import { submit, conversation } from "../tasks";
import { listInspiration } from "../inspiration";
import { wrapUntrusted } from "../untrusted";
import type { Conversation } from "../../contracts";

export const intelligenceInput = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    projectId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .default("personal"),
    conversationId: z.string().uuid().optional(),
    requestKey: z.string().uuid(),
    attachments: z.array(z.string().uuid()).max(4).default([]),
  })
  .strict();
type RequestRecord = {
  id: string;
  signature: string;
  conversationId: string;
  input: string;
};

// Reuse the same durable Hermes executor as chat, including stop, retry and recovery.
// Never generate creative directions or claim to have performed research in this layer.
export async function runCreativeIntelligence(
  owner: string,
  raw: z.input<typeof intelligenceInput>,
) {
  const input = intelligenceInput.parse(raw);
  if (redact(input.prompt) !== input.prompt)
    throw new ApiError(
      400,
      "sensitive_content",
      "需求不能包含憑證，請移除後再傳送。",
    );
  if (input.projectId !== "personal" && !get("project", owner, input.projectId))
    throw new ApiError(404, "project_not_found", "專案不存在。");
  if (
    input.conversationId &&
    conversation(owner, input.conversationId).projectId !== input.projectId
  )
    throw new ApiError(403, "scope_mismatch", "接續對話必須屬於同一專案。");
  const signature = hash(JSON.stringify(input));
  const request = transaction(() => {
    const existing = get<RequestRecord>(
      "intelligence_request",
      owner,
      input.requestKey,
    );
    if (existing) {
      if (existing.signature !== signature)
        throw new ApiError(
          409,
          "idempotency_conflict",
          "同一提交識別不能更換需求。",
        );
      return existing;
    }
    const id = input.conversationId || randomUUID();
    if (!input.conversationId) {
      const at = new Date().toISOString();
      put("conversation", owner, {
        id,
        title: redact(input.prompt).slice(0, 80),
        projectId: input.projectId,
        messages: [],
        hermesSessionId: null,
        createdAt: at,
        updatedAt: at,
      } satisfies Conversation);
    }
    const references = listInspiration(input.projectId)
      .slice(0, 10)
      .map((item) => ({
        id: item.id,
        sourceUrl: item.sourceUrl,
        caption: item.captionExcerpt,
        sourceType: item.sourceType,
        notice: "保存的參考，不代表已擷取網頁或讀取圖片",
      }));
    const content =
      input.prompt +
      "\n\n" +
      wrapUntrusted("saved_project_references", JSON.stringify(references));
    return put("intelligence_request", owner, {
      id: input.requestKey,
      signature,
      conversationId: id,
      input: content,
    });
  });
  const task = await submit(owner, {
    conversationId: request.conversationId,
    requestKey: request.id,
    input: request.input,
    attachments: input.attachments,
  });
  return {
    task,
    conversationId: request.conversationId,
    execution: "hermes" as const,
    resultSource: "task_output_and_tool_events",
    statusUrl: "/api/tasks",
    notice:
      "任務已保存並交由 Hermes 執行；工具回覆及成果需查回，不代表已完成研究或製作。",
  };
}
