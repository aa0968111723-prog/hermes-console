import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
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
          keys: z.array(z.string().max(80)).max(20).optional(),
          ...target,
        })
        .strict(),
      z.object({ action: z.literal("redeploy"), ...target }).strict(),
      z.object({ action: z.literal("restart"), ...target }).strict(),
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
  if (body.action === "update_env")
    return respond(await updateZeaburVariables(body.variables, override));
  if (body.action === "push_console_keys")
    return respond(await pushConsoleKeysToZeabur(body.keys, override));
  if (body.action === "redeploy") return respond(await redeployZeabur(override));
  return respond(await restartZeabur(override));
});
