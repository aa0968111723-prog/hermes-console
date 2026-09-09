import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  catalogNotice,
  happeningOn,
  loadCatalog,
  searchZenclubKnowledge,
  taipeiDay,
} from "@/lib/server/zenclub";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  authenticate(req);
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const when = url.searchParams.get("when");
  const catalog = loadCatalog();
  const today = taipeiDay();
  return respond({
    source: catalogNotice(),
    today,
    happeningToday:
      when === "today" || when === "upcoming"
        ? happeningOn(today).map((entity) => ({
            id: entity.id,
            title: entity.title,
            kind: entity.kind,
          }))
        : undefined,
    areas: catalog.areas.map((area) => ({
      id: area.id,
      name: area.name,
      kind: area.kind,
      indexed: area.indexed,
      note: area.note,
      url: area.url,
    })),
    result: searchZenclubKnowledge(
      when === "today" && !query ? "今天" : query,
    ),
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
