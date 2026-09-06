/**
 * Connects domain research → Audience Twin facts → ranked creative directions.
 */
import {
  extractContextFacts,
  resolveContextDomain,
  simulateAudienceReaction,
  type AudienceDomain,
} from "../audience-twin/engine.ts";
import type { AudienceFact, AudienceSimulationResult } from "../audience-twin/types.ts";
import { researchBundle } from "../research/providers.ts";
import {
  getRawDirectionsForDomain,
  type RawDirection,
} from "../creative-workflow/directions.ts";

export interface RankedResearchDirection {
  raw: RawDirection;
  simulation: AudienceSimulationResult;
  overallScore: number;
  researchEvidence: AudienceFact[];
  researchHypotheses: AudienceFact[];
}

export interface ResearchAudienceDirectionWorkflow {
  domain: AudienceDomain;
  connected: ["research", "audience", "directions"];
  research: ReturnType<typeof researchBundle>;
  audienceFacts: AudienceFact[];
  ranked: RankedResearchDirection[];
  topDirection: RankedResearchDirection;
  simulation: true;
  method: "ai_heuristic";
}

function claimsToFacts(
  claims: Array<{ claim: string; sourceId?: string | null; kind: string }>,
): AudienceFact[] {
  return claims.map((item) => {
    const evidence = item.kind === "evidence" && !!item.sourceId && !/seo\.example/.test(item.sourceId);
    return {
      statement: item.claim,
      kind: evidence ? "evidence" : "hypothesis",
      sourceTag: evidence
        ? `[官方網站] ${item.sourceId}`
        : "[心理推論假設] 研究摘要未經問卷驗證",
      confidence: evidence ? 80 : 35,
      sourceKind: evidence ? "official_web" : "heuristic",
      sourceUrl: evidence ? item.sourceId || null : null,
      liveFetch: false as const,
    };
  });
}

function factsUsedByDirection(direction: RawDirection, facts: AudienceFact[]): AudienceFact[] {
  const hay = `${direction.title} ${direction.hook} ${direction.coreInsight} ${direction.visualConcept}`;
  return facts.filter((fact) => {
    const tokens = fact.statement
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
      .slice(0, 8);
    return tokens.some((token) => hay.includes(token));
  });
}

export function runResearchAudienceDirectionWorkflow(input: {
  prompt: string;
  projectId?: string;
  tamkangReachable?: boolean;
}): ResearchAudienceDirectionWorkflow {
  const domain = resolveContextDomain(input.prompt, input.projectId);
  const research = researchBundle({
    prompt: input.prompt,
    mcpReachable: input.tamkangReachable,
  });
  const audienceFacts = [
    ...extractContextFacts(input.prompt, domain),
    ...claimsToFacts(research.claims),
  ];
  const rawDirections = getRawDirectionsForDomain(domain);
  const ranked: RankedResearchDirection[] = rawDirections
    .map((raw) => {
      const simulation = simulateAudienceReaction(
        raw.title,
        raw.coreInsight,
        raw.visualConcept,
        raw.hook,
        input.projectId,
      );
      const used = factsUsedByDirection(raw, audienceFacts);
      return {
        raw,
        simulation,
        overallScore: simulation.scores.overallScore,
        researchEvidence: used.filter((item) => item.kind === "evidence"),
        researchHypotheses: used.filter((item) => item.kind === "hypothesis"),
      };
    })
    .sort((a, b) => b.overallScore - a.overallScore);

  return {
    domain,
    connected: ["research", "audience", "directions"],
    research,
    audienceFacts,
    ranked,
    topDirection: ranked[0],
    simulation: true,
    method: "ai_heuristic",
  };
}
