import { z } from "zod";
import {
  authenticate,
  jsonBody,
  respond,
  route,
} from "@/lib/server/security";
import {
  interpretVerification,
  registerMcp,
  seedRegistry,
} from "@/lib/server/mcp-registry";
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
      initialize: z.boolean().optional(),
      toolsList: z.boolean().optional(),
      safeRead: z.boolean().optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  const entry = registerMcp(body);
  if (
    body.initialize !== undefined ||
    body.toolsList !== undefined ||
    body.safeRead !== undefined
  )
    entry.status = interpretVerification({
      initialize: !!body.initialize,
      toolsList: !!body.toolsList,
      safeRead: !!body.safeRead,
    });
  return respond({ server: entry }, 201);
});
