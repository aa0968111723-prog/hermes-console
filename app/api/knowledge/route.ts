import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  catalogNotice,
  loadCatalog,
  searchZenclubKnowledge,
} from "@/lib/server/zenclub";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  authenticate(req);
  const query = new URL(req.url).searchParams.get("q") || "";
  const catalog = loadCatalog();
  return respond({
    source: catalogNotice(),
    areas: catalog.areas.map((area) => ({
      id: area.id,
      name: area.name,
      kind: area.kind,
      indexed: area.indexed,
      note: area.note,
      url: area.url,
    })),
    result: searchZenclubKnowledge(query),
  });
});

export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      q: z.string().max(500).default(""),
    })
    .strict()
    .parse(await jsonBody(req));
  return respond({
    source: catalogNotice(),
    result: searchZenclubKnowledge(body.q),
  });
});
