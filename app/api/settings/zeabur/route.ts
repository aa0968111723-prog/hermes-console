import { z } from "zod";
import {
  authenticate,
  consumeConfirmation,
  jsonBody,
  mintConfirmation,
  respond,
  route,
} from "@/lib/server/security";
import {
  listZeaburProjects,
  listZeaburVariables,
  pushConsoleKeysToZeabur,
  redeployZeabur,
  restartZeabur,
  testZeabur,
  updateZeaburVariables,
} from "@/lib/server/zeabur";

export const runtime = "nodejs";

const target = {
  projectId: z.string().regex(/^[a-zA-Z0-9]{8,40}$/).optional(),
  serviceId: z.string().regex(/^[a-zA-Z0-9]{8,40}$/).optional(),
  environmentId: z.string().regex(/^[a-zA-Z0-9]{8,40}$/).optional(),
};
const confirmationToken = z.string().max(128).optional();

const SUMMARIES: Record<string, string> = {
  update_env: "即將寫入 Zeabur 環境變數。此操作會改變正式部署設定。",
  push_console_keys: "即將把 Console 已存的 Hermes／MCP／淡江金鑰推送到 Zeabur。",
  redeploy: "即將要求 Zeabur 重新部署此服務。",
  restart: "即將要求 Zeabur 重啟此服務。",
};

function confirmPayload(body: { confirmationToken?: string } & Record<string, unknown>) {
  const { confirmationToken: _ignored, ...payload } = body;
  void _ignored;
  return payload;
}

function requireMutationConfirmation(body: {
  action: string;
  confirmationToken?: string;
} & Record<string, unknown>) {
  const payload = confirmPayload(body);
  if (!body.confirmationToken) {
    const minted = mintConfirmation({
      action: "external_mutation",
      target: "zeabur:" + body.action,
      payload,
    });
    return {
      pending: true as const,
      response: {
        needsConfirmation: true,
        summary: SUMMARIES[body.action] || "此操作有副作用，需要你確認。",
        ...minted,
      },
    };
  }
  consumeConfirmation({
    token: body.confirmationToken,
    action: "external_mutation",
    target: "zeabur:" + body.action,
    payload,
  });
  return { pending: false as const };
}

export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("test"), ...target }).strict(),
      z.object({ action: z.literal("list"), ...target }).strict(),
      z.object({ action: z.literal("variables"), ...target }).strict(),
      z
        .object({
          action: z.literal("update_env"),
          confirmationToken,
          variables: z
            .array(
              z
                .object({
                  key: z.string().regex(/^[A-Z][A-Z0-9_]{0,80}$/),
                  value: z.string().min(1).max(8_000),
                })
                .strict(),
            )
            .min(1)
            .max(40),
          ...target,
        })
        .strict(),
      z
        .object({
          action: z.literal("push_console_keys"),
          confirmationToken,
          keys: z.array(z.string().max(80)).max(20).optional(),
          ...target,
        })
        .strict(),
      z
        .object({ action: z.literal("redeploy"), confirmationToken, ...target })
        .strict(),
      z
        .object({ action: z.literal("restart"), confirmationToken, ...target })
        .strict(),
    ])
    .parse(await jsonBody(req, 20_000));
  const override = {
    projectId: body.projectId,
    serviceId: body.serviceId,
    environmentId: body.environmentId,
  };
  if (body.action === "test") return respond(await testZeabur());
  if (body.action === "list") return respond(await listZeaburProjects());
  if (body.action === "variables")
    return respond(await listZeaburVariables(override));
  const confirmed = requireMutationConfirmation(body);
  if (confirmed.pending) return respond(confirmed.response);
  if (body.action === "update_env")
    return respond(await updateZeaburVariables(body.variables, override));
  if (body.action === "push_console_keys")
    return respond(await pushConsoleKeysToZeabur(body.keys, override));
  if (body.action === "redeploy") return respond(await redeployZeabur(override));
  return respond(await restartZeabur(override));
});
