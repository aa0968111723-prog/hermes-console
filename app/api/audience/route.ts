import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  AUDIENCE_DISCLAIMER,
  debateSummary,
  normalizeScores,
  tamkangFreshmanSeed,
  wantsReverseThinking,
} from "@/lib/server/audience";
import { buildProfile, contextGraph } from "@/lib/server/audience/engine";
import { evaluateWithTwins } from "@/lib/server/audience/evaluation";
import { debateFromEvaluations } from "@/lib/server/audience/debate";
import { simulateFreshmanReactions } from "@/lib/server/audience/personas";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  authenticate(req);
  const prompt = new URL(req.url).searchParams.get("q") || "";
  return respond({
    reverse: wantsReverseThinking(prompt),
    disclaimer: AUDIENCE_DISCLAIMER,
    simulation: true,
    method: "rule_heuristic",
    twin: /淡江|新生/.test(prompt) ? tamkangFreshmanSeed([]) : null,
  });
});
export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      action: z.enum(["twin", "score", "debate", "evaluate", "profile", "simulate"]),
      label: z.string().max(120).optional(),
      institution: z.string().max(80).optional(),
      location: z.string().max(80).optional(),
      ageRange: z.string().max(40).optional(),
      lifeStage: z.string().max(80).optional(),
      copy: z.string().max(4000).optional(),
      title: z.string().max(200).optional(),
      kind: z
        .enum(["poster", "ig", "form", "event", "booth", "layout", "copy"])
        .optional(),
      visualNotes: z.string().max(1000).optional(),
      projectId: z.string().max(100).optional(),
      scores: z.record(z.string(), z.number()).optional(),
      support: z.array(z.string().max(500)).max(10).optional(),
      oppose: z.array(z.string().max(500)).max(10).optional(),
      concerns: z.array(z.string().max(500)).max(10).optional(),
      revisions: z.array(z.string().max(500)).max(10).optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  if (body.action === "twin")
    return respond({
      twin: tamkangFreshmanSeed([]),
      disclaimer: AUDIENCE_DISCLAIMER,
      simulation: true,
      method: "rule_heuristic",
    });
  if (body.action === "profile") {
    const profile = buildProfile({
      projectId: body.projectId || "personal",
      institution: body.institution || "淡江大學",
      location: body.location || "淡水",
      name: body.label || "淡江大一新生",
      ageRange: body.ageRange,
      lifeStage: body.lifeStage,
    });
    return respond({
      profile,
      graph: contextGraph(profile.institution),
      simulation: true,
      method: "rule_heuristic",
    });
  }
  if (body.action === "simulate")
    return respond(
      simulateFreshmanReactions({
        kind: body.kind,
        title: body.title,
        copy: body.copy || "",
        visualNotes: body.visualNotes,
        institution: body.institution || "淡江大學",
        location: body.location || "淡水",
      }),
    );
  if (body.action === "evaluate") {
    const profile = buildProfile({
      projectId: body.projectId || "personal",
      institution: body.institution || "淡江大學",
      location: body.location || "淡水",
      name: body.label || "淡江大一新生",
      ageRange: body.ageRange,
      lifeStage: body.lifeStage,
    });
    const evaluated = evaluateWithTwins({
      profile,
      copy: body.copy || "",
      title: body.title,
      kind: body.kind,
      visualNotes: body.visualNotes,
    });
    return respond({
      ...evaluated,
      debate: debateFromEvaluations(evaluated.roles),
    });
  }
  if (body.action === "score")
    return respond({
      ...normalizeScores(body.scores || {}),
      simulation: true,
      method: "rule_heuristic",
    });
  return respond(
    debateSummary({
      support: body.support || [],
      oppose: body.oppose || [],
      concerns: body.concerns || [],
      revisions: body.revisions || [],
    }),
  );
});
