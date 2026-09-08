import { z } from "zod";
import { authenticate, route } from "@/lib/server/security";
import { workflow } from "@/lib/server/workflows";
import { generateCreativeStrategyMarkdown } from "@/lib/client/export-brief";

export const runtime = "nodejs";
export const GET = route(async request => {
  const owner = authenticate(request);
  const query = z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    direction: z.string().regex(/^[0-4]$/).transform(Number),
  }).parse(Object.fromEntries(new URL(request.url).searchParams));
  const record = workflow(owner, query.id);
  const index = z.number().int().min(0).max(record.directions.length - 1).parse(query.direction);
  return new Response(generateCreativeStrategyMarkdown(record, index), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="hermes-direction-' + (index + 1) + '.md"',
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
