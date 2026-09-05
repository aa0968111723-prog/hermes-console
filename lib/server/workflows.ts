import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, hash, redact } from "./security";
import { get, list, put, transaction } from "./store";
import { canvaRequest } from "./canva";
const url = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const direction = z
  .object({
    title: z.string().min(1).max(120),
    coreIdea: z.string().max(2000).optional(),
    claim: z.string().max(2000),
    audienceInsight: z.string().max(4000).optional(),
    visual: z.string().max(4000),
    composition: z.string().max(2000).optional(),
    color: z.string().max(1000).optional(),
    typography: z.string().max(1000).optional(),
    copy: z.string().max(5000),
    cta: z.string().max(1000),
    platform: z.string().max(100).optional(),
    references: z.array(url).max(20).optional(),
    sources: z.array(url).max(20),
    risks: z.array(z.string().max(500)).max(10).optional(),
    audienceScores: z.record(z.string(), z.number().min(0).max(100)).optional(),
    audienceFeedback: z.string().max(4000).optional(),
    revisionSuggestions: z.array(z.string().max(500)).max(10).optional(),
  })
  .strict();
export const directionsInput = z
  .object({
    projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    brief: z.string().min(1).max(10_000),
    directions: z.array(direction).min(3).max(5),
  })
  .strict();
export interface Workflow {
  id: string;
  projectId: string;
  brief: string;
  directions: z.infer<typeof direction>[];
  selected: number | null;
  state:
    | "awaiting_selection"
    | "ready"
    | "waiting_authorization"
    | "creating"
    | "draft_ready"
    | "uncertain"
    | "failed";
  createdAt: string;
  updatedAt: string;
  canvaJobId: string | null;
  design: Record<string, unknown> | null;
  error: string | null;
}
export function saveDirections(
  owner: string,
  input: z.infer<typeof directionsInput>,
) {
  if (input.projectId !== "personal" && !get("project", owner, input.projectId))
    throw new ApiError(404, "project_not_found", "專案不存在。");
  // Replay identical model calls without creating duplicate workflows.
  const id = hash(JSON.stringify(input));
  const existing = get<Workflow>("workflow", owner, id);
  if (existing) return existing;
  const record: Workflow = {
    ...input,
    id,
    selected: null,
    state: "awaiting_selection",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canvaJobId: null,
    design: null,
    error: null,
  };
  return put("workflow", owner, record);
}
export function workflow(owner: string, id: string) {
  const record = get<Workflow>("workflow", owner, id);
  if (!record)
    throw new ApiError(404, "workflow_not_found", "找不到創作流程。");
  return record;
}
export function chooseDirection(owner: string, id: string, selected: number) {
  return transaction(() => {
    const record = workflow(owner, id);
    if (["creating", "draft_ready", "uncertain"].includes(record.state))
      throw new ApiError(
        409,
        "workflow_locked",
        "設計已提交，不能覆寫選擇；請建立新的創作版本。",
      );
    if (
      !Number.isInteger(selected) ||
      selected < 0 ||
      selected >= record.directions.length
    )
      throw new ApiError(400, "invalid_direction", "請選擇其中一個創作方向。");
    return put("workflow", owner, {
      ...record,
      selected,
      state: "ready",
      updatedAt: new Date().toISOString(),
    } satisfies Workflow);
  });
}
export const autofillInput = z
  .object({
    workflowId: z.string().regex(/^[a-f0-9]{64}$/),
    fields: z.record(
      z.string().max(100),
      z.discriminatedUnion("type", [
        z
          .object({ type: z.literal("text"), text: z.string().max(10_000) })
          .strict(),
        z
          .object({
            type: z.literal("image"),
            asset_id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export async function templateDataset(owner: string) {
  const template = process.env.CANVA_BRAND_TEMPLATE_ID;
  if (!template || !/^[a-zA-Z0-9_-]+$/.test(template))
    throw new ApiError(
      409,
      "template_required",
      "請先設定可 autofill 的 Canva Brand Template ID；此能力受 Canva 方案與權限限制。",
    );
  return canvaRequest(owner, "/brand-templates/" + template + "/dataset");
}
export async function createDraft(
  owner: string,
  input: z.infer<typeof autofillInput>,
) {
  let record = workflow(owner, input.workflowId);
  if (record.selected === null)
    throw new ApiError(
      409,
      "selection_required",
      "必須由使用者在 Console 選定方向後才能製作草稿。",
    );
  if (record.canvaJobId || ["creating", "uncertain"].includes(record.state))
    return record;
  try {
    const raw = await templateDataset(owner);
    const dataset = raw.dataset as
      | Record<string, { type?: string }>
      | undefined;
    for (const [key, value] of Object.entries(input.fields))
      if (!dataset?.[key] || dataset[key].type !== value.type)
        throw new ApiError(
          400,
          "template_field_mismatch",
          "欄位與實際 Canva 範本不符，請重新讀取範本資料集。",
        );
  } catch (error) {
    record.error = error instanceof ApiError ? error.message : "無法查詢範本。";
    record.state = "waiting_authorization";
    put("workflow", owner, record);
    throw error;
  }
  const reservation = transaction(() => {
    const latest = workflow(owner, input.workflowId);
    if (
      latest.state === "creating" ||
      latest.state === "uncertain" ||
      latest.canvaJobId
    )
      return { execute: false, record: latest };
    return {
      execute: true,
      record: put("workflow", owner, {
        ...latest,
        state: "creating",
        error: null,
        updatedAt: new Date().toISOString(),
      } satisfies Workflow),
    };
  });
  record = reservation.record;
  if (!reservation.execute) return record;
  // Reservation persists before the external side effect; ambiguous failures are never replayed.
  try {
    const result = await canvaRequest(owner, "/autofills", {
      method: "POST",
      body: JSON.stringify({
        brand_template_id: process.env.CANVA_BRAND_TEMPLATE_ID,
        data: input.fields,
      }),
    });
    const parsed = z
      .object({ job: z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) }) })
      .parse(result);
    return put("workflow", owner, {
      ...record,
      canvaJobId: parsed.job.id,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return put("workflow", owner, {
      ...record,
      state: "uncertain",
      error:
        error instanceof ApiError
          ? error.message
          : "Canva 回應無法確認；請至 Canva 查詢，不會自動重送。",
      updatedAt: new Date().toISOString(),
    } satisfies Workflow);
  }
}
export async function pollDraft(owner: string, id: string) {
  const record = workflow(owner, id);
  if (!record.canvaJobId || record.state === "draft_ready") return record;
  const data = await canvaRequest(owner, "/autofills/" + record.canvaJobId);
  const job = data.job as
    | { status?: string; result?: { design?: Record<string, unknown> } }
    | undefined;
  if (job?.status === "success" && job.result?.design) {
    record.design = JSON.parse(redact(JSON.stringify(job.result.design)));
    record.state = "draft_ready";
  } else if (job?.status === "failed") {
    record.state = "failed";
    record.error = "Canva 回報製作失敗。";
  }
  record.updatedAt = new Date().toISOString();
  return put("workflow", owner, record);
}
export function listWorkflows(owner: string) {
  return list<Workflow>("workflow", owner);
}
