import { z } from "zod";
import { fieldLabels } from "./activity-labels";
export { fieldLabels } from "./activity-labels";
export const projectKey = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const sourceURL = z
  .string()
  .url()
  .max(2000)
  .refine((s) => {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "來源必須是不含帳密的 HTTPS 連結。");
export const factInput = z
  .object({
    field: z.enum(
      Object.keys(fieldLabels) as [
        keyof typeof fieldLabels,
        ...(keyof typeof fieldLabels)[],
      ],
    ),
    value: z.string().trim().min(1).max(1000),
    visibility: z.enum(["public", "private"]).default("public"),
    sources: z
      .array(
        z
          .object({
            url: sourceURL,
            queriedAt: z.string().datetime(),
            note: z.string().max(500).default(""),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();
export const activityInput = z
  .object({
    id: z.string().uuid().optional(),
    projectId: projectKey,
    expectedRevision: z.number().int().min(0),
    operationId: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    facts: z.array(factInput).max(60),
  })
  .strict();
export type Fact = z.infer<typeof factInput> & {
  id: string;
  state: "pending" | "user_provided" | "confirmed" | "rejected";
};
export type ActivityRevision = {
  revision: number;
  title: string;
  facts: Fact[];
  at: string;
  actor: "owner" | "hermes";
};
export type Activity = ActivityRevision & {
  id: string;
  projectId: string;
  history: ActivityRevision[];
};
export const copyInput = z
  .object({
    id: z.string().uuid().optional(),
    projectId: projectKey,
    activityId: z.string().uuid(),
    workflowId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    expectedRevision: z.number().int().min(0),
    operationId: z.string().uuid(),
    title: z.string().trim().min(1).max(150),
    format: z.enum(["post", "carousel", "story", "reel"]),
    tone: z.string().max(300).default(""),
    audience: z.string().max(500).default(""),
    pages: z
      .array(
        z
          .object({
            title: z.string().max(200),
            body: z.string().min(1).max(10_000),
            visual: z.string().max(2000).default(""),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    materialIds: z.array(z.string().uuid()).max(20).default([]),
    factIds: z.array(z.string().max(64)).max(60).default([]),
  })
  .strict();
export type CopyRevision = Omit<
  z.infer<typeof copyInput>,
  "id" | "expectedRevision" | "operationId"
> & {
  revision: number;
  at: string;
  actor: "owner" | "hermes";
  activityRevision: number;
};
export type CopyDocument = {
  id: string;
  projectId: string;
  activityId: string;
  selectedRevision: number | null;
  revisions: CopyRevision[];
};
export type CopyCheck = {
  issues: string[];
  checkedFacts: string[];
  readyForHumanReview: boolean;
  automaticVerificationComplete: false;
};
