import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  getCertification,
  publicReport,
  runCertification,
} from "@/lib/server/certification";

export const runtime = "nodejs";

const integrations = z.enum([
  "hermes",
  "zeabur",
  "tamkang",
  "canva",
  "memory",
  "mcp",
  "research",
]);

export const GET = route(async (request) => {
  const owner = authenticate(request);
  return respond({ report: publicReport(getCertification(owner)) });
});

export const POST = route(async (request) => {
  const owner = authenticate(request, true);
  const body = z
    .object({
      action: z.literal("run"),
      integrations: z.array(integrations).max(7).optional(),
    })
    .strict()
    .parse(await jsonBody(request));
  const report = await runCertification(owner, body.integrations);
  return respond({ report: publicReport(report) });
});
