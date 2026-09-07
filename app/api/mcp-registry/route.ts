import { z } from "zod";
import {
  authenticate,
  jsonBody,
  respond,
  route,
  consumeConfirmation,
} from "@/lib/server/security";
import { getMcp, probeMcp, registerMcp, seedRegistry, setMcpEnabled } from "@/lib/server/mcp-registry";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  authenticate(req);
  return respond({ servers: seedRegistry() });
});
export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      id: z.string().regex(/^[a-zA-Z0-9_-]{2,40}$/),
      name: z.string().min(1).max(80),
      endpoint: z.string().url(),
      transport: z.enum(["streamable-http", "stdio"]).optional(),
      authMode: z.enum(["none", "bearer"]).optional(),
      credentialReference: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .nullable()
        .optional(),
      readonly: z.boolean().optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  const entry = registerMcp(body);
  return respond({ server: await probeMcp(entry) }, 201);
});
export const PATCH = route(async req => {
  authenticate(req, true);
  const body = z.object({ action: z.enum(["refresh", "test", "enable", "disable"]), id: z.string().regex(/^[a-zA-Z0-9_-]{2,40}$/), confirmationToken: z.string().optional() }).strict().parse(await jsonBody(req, 4000));
  if (body.action === "disable") consumeConfirmation({ token: body.confirmationToken, action: "destructive", target: "mcp:" + body.id, payload: { enabled: false } });
  if (body.action === "enable") return respond({ server: await probeMcp(setMcpEnabled(body.id, true)) });
  if (body.action === "disable") return respond({ server: setMcpEnabled(body.id, false) });
  const entry = getMcp(body.id);
  if (!entry) return respond({ error: { code: "mcp_not_found", message: "找不到可管理的 MCP。" } }, 404);
  return respond({ server: await probeMcp(entry) });
});
