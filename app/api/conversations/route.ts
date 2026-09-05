import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  ApiError,
  authenticate,
  jsonBody,
  redact,
  respond,
  route,
} from "@/lib/server/security";
import { get, list, put, transaction } from "@/lib/server/store";
import { conversation } from "@/lib/server/tasks";
import { health, readJSON, upstream, visibleText } from "@/lib/server/hermes";
import type { Conversation, Message } from "@/lib/contracts";
export const runtime = "nodejs";
const timestamp = () => new Date().toISOString();
const projectId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const GET = route(async (req) => {
  const owner = authenticate(req);
  const id = z.string().uuid().parse(new URL(req.url).searchParams.get("id"));
  const conv = conversation(owner, id);
  const connection = await health(owner);
  if (!conv.hermesSessionId || !connection.features.session_resources)
    return respond({
      conversation: conv,
      remoteHistory: null,
      syncStatus: "unsupported",
    });
  const raw = await readJSON(
    await upstream("/api/sessions/" + conv.hermesSessionId + "/messages"),
  );
  const input = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.messages)
      ? raw.messages
      : [];
  const remoteHistory = input.slice(-200).flatMap((item) => {
    const parsed = z
      .object({
        role: z.string(),
        content: z.unknown().optional(),
        name: z.string().optional(),
        tool_call_id: z.string().optional(),
        timestamp: z.unknown().optional(),
      })
      .safeParse(item);
    if (
      !parsed.success ||
      !["user", "assistant", "tool"].includes(parsed.data.role)
    )
      return [];
    const content =
      typeof parsed.data.content === "string"
        ? parsed.data.content
        : JSON.stringify(parsed.data.content ?? "");
    return [
      {
        role: parsed.data.role,
        content: visibleText(content),
        name: parsed.data.name,
        toolCallId: parsed.data.tool_call_id,
      },
    ];
  });
  return respond({
    conversation: conv,
    remoteHistory,
    syncStatus: "synced",
    queriedAt: timestamp(),
  });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const body = z
    .object({
      title: z.string().trim().max(100).default("新對話"),
      projectId: projectId.default("personal"),
      parentId: z.string().uuid().optional(),
      beforeMessageId: z.string().uuid().optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  if (body.projectId !== "personal" && !get("project", owner, body.projectId))
    throw new ApiError(404, "project_not_found", "專案不存在。");
  let messages: Message[] = [];
  if (body.parentId) {
    const parent = conversation(owner, body.parentId);
    if (parent.projectId !== body.projectId)
      throw new ApiError(403, "scope_mismatch", "分支必須保留專案範圍。");
    const index = parent.messages.findIndex(
      (m) => m.id === body.beforeMessageId,
    );
    if (index < 0)
      throw new ApiError(400, "message_not_found", "分支起點不存在。");
    messages = parent.messages
      .slice(0, index)
      .map((m) => ({ ...m, id: randomUUID(), taskId: undefined }));
  }
  const conv: Conversation = {
    id: randomUUID(),
    title: body.title || "新對話",
    projectId: body.projectId,
    messages,
    hermesSessionId: null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    parentId: body.parentId,
  };
  return respond({ conversation: put("conversation", owner, conv) }, 201);
});
const legacySchema = z
  .array(
    z
      .object({
        id: z.string().max(200),
        title: z.string().max(200).optional(),
        messages: z
          .array(
            z
              .object({
                role: z.enum(["user", "assistant", "system"]),
                content: z.string().max(200_000),
                timestamp: z.string().optional(),
              })
              .passthrough(),
          )
          .max(500),
      })
      .passthrough(),
  )
  .max(100);
export const PUT = route(async (req) => {
  const owner = authenticate(req, true);
  const old = legacySchema.parse(await jsonBody(req, 5_000_000));
  let imported = 0;
  transaction(() => {
    for (const legacy of old) {
      if (
        list<Conversation>("conversation", owner).some(
          (c) => c.legacyId === legacy.id,
        )
      )
        continue;
      const conv: Conversation = {
        id: randomUUID(),
        legacyId: legacy.id,
        title: (legacy.title || "匯入的舊對話").slice(0, 100),
        projectId: "personal",
        hermesSessionId: null,
        createdAt: timestamp(),
        updatedAt: timestamp(),
        messages: legacy.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            id: randomUUID(),
            role: m.role as "user" | "assistant",
            content: visibleText(redact(m.content)),
            createdAt: timestamp(),
            provenance: "legacy_unverified",
          })),
      };
      put("conversation", owner, conv);
      imported++;
    }
  });
  return respond({
    imported,
    notice:
      "舊對話已保存；舊助理回覆未經 Hermes 驗證，不是已同步的 Agent 記憶。",
  });
});
