import { z } from "zod";
import { ApiError, authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  COPY_CHANNELS,
  COPY_REVIEW_DISCLAIMER,
  COPY_VARIANT_LABELS,
  FRESHMAN_TWINS,
  factsFromActivityRecord,
  reviewCopy,
  reviewSavedCopy,
} from "@/lib/server/copywriting";
import { activity, publicCopy } from "@/lib/server/creative";

export const runtime = "nodejs";

const factsSchema = z
  .object({
    name: z.string().max(200).optional(),
    date: z.string().max(80).optional(),
    time: z.string().max(80).optional(),
    location: z.string().max(200).optional(),
    formUrl: z.string().max(500).optional(),
  })
  .strict()
  .optional();

function factsFromActivity(owner: string, activityId: string) {
  return factsFromActivityRecord(activity(owner, activityId));
}

export const GET = route(async (req) => {
  authenticate(req);
  return respond({
    simulation: true,
    method: "rule_contract",
    publish: false,
    disclaimer: COPY_REVIEW_DISCLAIMER,
    channels: COPY_CHANNELS,
    variants: COPY_VARIANT_LABELS,
    personas: FRESHMAN_TWINS.map((item) => ({
      id: item.id,
      label: item.label,
    })),
    structure: ["HOOK", "生活場景", "活動", "為什麼來", "時間／地點", "CTA"],
  });
});

export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const body = z
    .object({
      action: z.enum(["review", "review_saved"]).default("review"),
      channel: z.enum(COPY_CHANNELS).optional(),
      title: z.string().max(200).optional(),
      copy: z.string().max(8000).optional(),
      variants: z
        .object({
          a: z.string().max(8000).optional(),
          b: z.string().max(8000).optional(),
          c: z.string().max(8000).optional(),
        })
        .strict()
        .optional(),
      facts: factsSchema,
      allowSpiritual: z.boolean().optional(),
      copyId: z.string().uuid().optional(),
      activityId: z.string().uuid().optional(),
    })
    .strict()
    .parse(await jsonBody(req));

  if (body.action === "review_saved" || body.copyId) {
    if (!body.copyId)
      throw new ApiError(400, "copy_id_required", "審核已保存文案需要 copyId。");
    const document = publicCopy(owner, body.copyId);
    const revision = document.revisions.at(-1);
    const facts = factsFromActivity(owner, document.activityId);
    return respond({
      ...reviewSavedCopy({
        format: revision?.format,
        title: revision?.title,
        pages: revision?.pages,
        facts,
        allowSpiritual: body.allowSpiritual,
      }),
      copyId: document.id,
    });
  }

  const activityFacts = body.activityId
    ? factsFromActivity(owner, body.activityId)
    : {};
  return respond(
    reviewCopy({
      channel: body.channel,
      title: body.title,
      copy: body.copy,
      variants: body.variants,
      facts: { ...activityFacts, ...body.facts },
      allowSpiritual: body.allowSpiritual,
    }),
  );
});
