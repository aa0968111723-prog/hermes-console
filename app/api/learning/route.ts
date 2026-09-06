import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { learningInput } from "@/lib/learning";
import { projectKey } from "@/lib/creative";
import { listLearning, saveLearning, startLearning } from "@/lib/server/learning";
export const runtime = "nodejs";
export const GET = route(async req => {
  const owner = authenticate(req);
  return respond({
    nodes: listLearning(owner, projectKey.parse(new URL(req.url).searchParams.get("projectId") || "personal")),
    remoteMemoryVerified: false,
    scopeVerified: process.env.HERMES_LEARNING_SCOPE_VERIFIED === "true",
    notice: "這是使用者指定學習資料與真實任务地圖，不是 Hermes 記憶全文。任務完成不等於已保存或已忘記。",
  });
});
export const POST = route(async req => {
  const owner = authenticate(req, true);
  return respond({ node: saveLearning(owner, learningInput.parse(await jsonBody(req, 20_000))) }, 201);
});
export const PATCH = route(async req => {
  const owner = authenticate(req, true);
  const input = z.object({ id: z.string().uuid(), expectedRevision: z.number().int().positive(), action: z.enum(["learn", "forget"]) }).strict().parse(await jsonBody(req));
  return respond({ node: await startLearning(owner, input.id, input.expectedRevision, input.action) });
});
