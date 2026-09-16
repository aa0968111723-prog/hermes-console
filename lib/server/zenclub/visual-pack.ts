import { randomUUID } from "node:crypto";
import type { Fact } from "../../creative";
import type { VisualPackView } from "../../client/visual-pack";
import { compileVisualConcepts } from "../creative/visual-concepts";
import type { KnowledgeClaim, KnowledgeEntity } from "./types";

const CLAIM_TO_FACT: Record<string, Fact["field"]> = {
  date: "date",
  dates: "date",
  time: "time",
  place: "location",
  location: "location",
  registration: "registration",
};

function sourceTime(claim: KnowledgeClaim) {
  const raw = claim.sources[0]?.modifiedAt;
  if (raw && !Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  return new Date().toISOString();
}

function factsFromEntity(entity: KnowledgeEntity): Fact[] {
  const facts: Fact[] = [
    {
      id: randomUUID(),
      field: "name",
      value: entity.title.slice(0, 1000),
      visibility: "public",
      sources: [],
      state: "confirmed",
    },
  ];
  for (const claim of entity.claims) {
    const field = CLAIM_TO_FACT[claim.field];
    if (!field || !claim.value) continue;
    const verified = claim.status === "VERIFIED" || claim.status === "LIKELY";
    facts.push({
      id: randomUUID(),
      field,
      value: claim.value.slice(0, 1000),
      visibility: "public",
      sources: claim.sources
        .filter((source) => source.url.startsWith("https://"))
        .slice(0, 8)
        .map((source) => ({
          url: source.url,
          queriedAt: sourceTime(claim),
          note: source.title.slice(0, 500),
        })),
      state: verified ? "confirmed" : "pending",
    });
  }
  return facts;
}

export function knowledgeVisualPack(
  entity: KnowledgeEntity,
  honesty: string,
): VisualPackView {
  const compiled = compileVisualConcepts({
    id: randomUUID(),
    title: entity.title,
    facts: factsFromEntity(entity),
  });
  return {
    title: compiled.title,
    notice: `${honesty} ${compiled.notice}`,
    generatedImage: false,
    rendered: false,
    publish: false,
    format: {
      id: compiled.format.id,
      label: compiled.format.label,
      width: compiled.format.width,
      height: compiled.format.height,
      aspect: compiled.format.aspect,
    },
    unknownFields: compiled.unknownFields,
    overlayText: compiled.overlayText,
    concepts: compiled.concepts.map((concept) => ({
      id: concept.id,
      name: concept.name,
      creativeDirection: concept.creativeDirection,
      background: concept.background,
      visualHierarchy: concept.visualHierarchy,
      generatedImage: false as const,
      rendered: false as const,
      qrPlacement: {
        include: concept.qrPlacement.include,
        reason: concept.qrPlacement.reason,
      },
      ctaPlacement: { copy: concept.ctaPlacement.copy },
      layout: {
        formatId: concept.layout.formatId,
        textCoverageMaxPct: concept.layout.textCoverageMaxPct,
        zones: Object.fromEntries(
          Object.entries(concept.layout.zones).map(([key, zone]) => [
            key,
            {
              xPct: zone.xPct,
              yPct: zone.yPct,
              wPct: zone.wPct,
              hPct: zone.hPct,
            },
          ]),
        ),
      },
    })),
  };
}
