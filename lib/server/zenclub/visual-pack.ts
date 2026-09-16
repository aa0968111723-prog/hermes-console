import { randomUUID } from "node:crypto";
import type { Fact } from "../../creative";
import type { VisualPackView } from "../../client/visual-pack";
import { compileVisualConcepts } from "../creative/visual-concepts";
import { ApiError } from "../security";
import { saveDirections } from "../workflows";
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

export function factsFromEntity(entity: KnowledgeEntity): Fact[] {
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

function shortTime(value: string | null | undefined) {
  if (!value) return "";
  return value.split(/[（(]/)[0]?.trim() || value;
}

function captionsFromCompiled(
  compiled: ReturnType<typeof compileVisualConcepts>,
): NonNullable<VisualPackView["captions"]> {
  const overlay = compiled.overlayText;
  const when = [overlay.date, shortTime(overlay.time)].filter(Boolean).join(" ");
  return {
    A: captionFor(compiled, "A", when),
    B: captionFor(compiled, "B", when),
    C: captionFor(compiled, "C", when),
  };
}

function captionFor(
  compiled: ReturnType<typeof compileVisualConcepts>,
  id: "A" | "B" | "C",
  when: string,
) {
  const concept = compiled.concepts.find((item) => item.id === id)!;
  const overlay = compiled.overlayText;
  return {
    hook: (overlay.name || compiled.title).slice(0, 150),
    body: [when, concept.creativeDirection].filter(Boolean).join("\n"),
    cta: overlay.registration ? "報名" : null,
  };
}

function viewFromCompiled(
  compiled: ReturnType<typeof compileVisualConcepts>,
  honesty: string,
  workflowId?: string,
): VisualPackView {
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
    workflowId,
    captions: captionsFromCompiled(compiled),
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

export function knowledgeVisualPack(
  entity: KnowledgeEntity,
  honesty: string,
): VisualPackView {
  return viewFromCompiled(
    compileVisualConcepts({
      id: randomUUID(),
      title: entity.title,
      facts: factsFromEntity(entity),
    }),
    honesty,
  );
}

export function persistKnowledgeVisualPack(
  owner: string,
  projectId: string,
  brief: string,
  entity: KnowledgeEntity,
  honesty: string,
): VisualPackView {
  const compiled = compileVisualConcepts({
    id: randomUUID(),
    title: entity.title,
    facts: factsFromEntity(entity),
  });
  const pack = viewFromCompiled(compiled, honesty);
  try {
    const workflow = saveDirections(owner, {
      projectId: projectId || "personal",
      brief: brief.slice(0, 10_000),
      directions: compiled.directions.map((item) => ({
        title: item.title.slice(0, 120),
        claim: item.claim.slice(0, 2000),
        visual: item.visual.slice(0, 4000),
        composition: item.composition.slice(0, 2000),
        color: item.color.slice(0, 1000),
        typography: item.typography.slice(0, 1000),
        copy: (item.copy || compiled.title).slice(0, 5000),
        cta: item.cta.slice(0, 1000),
        platform: item.platform.slice(0, 100),
        sources: item.sources
          .filter((source) => source.startsWith("https://"))
          .slice(0, 20),
        risks: item.risks.slice(0, 10).map((risk) => risk.slice(0, 500)),
      })),
    });
    pack.workflowId = workflow.id;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
  return pack;
}
