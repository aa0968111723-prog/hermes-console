import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { listRuntimeBindings, saveRuntimeBinding } from "@/lib/server/hermes/sync-manager";
export const runtime = "nodejs";
const input = z.object({ projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), agentId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(), toolName: z.string().min(1).max(300), enabled: z.boolean(), priority: z.number().int().min(-100).max(100).default(0), allowedTools: z.array(z.string().max(300)).max(100).default([]), blockedTools: z.array(z.string().max(300)).max(100).default([]), permissionOverrides: z.record(z.string(), z.enum(["read", "draft", "write", "publish", "destructive", "confirm"])).default({}) }).strict();
export const GET = route(async req => { const owner = authenticate(req); return respond({ bindings: listRuntimeBindings(owner, new URL(req.url).searchParams.get("projectId") || undefined) }); });
export const POST = route(async req => { const owner = authenticate(req, true); return respond({ binding: saveRuntimeBinding(owner, input.parse(await jsonBody(req, 20_000))) }, 201); });
