import { z } from "zod";
import {
  checkOrigin,
  jsonBody,
  respond,
  route,
  WORKSPACE_OWNER,
  verifyGateway,
} from "@/lib/server/security";
export const runtime = "nodejs";
export const GET = route(async (request) => {
  verifyGateway(request);
  return respond({
    workspace: { id: WORKSPACE_OWNER, mode: "no-login" },
  });
});
export const POST = route(async (request) => {
  checkOrigin(request);
  z.object({})
    .passthrough()
    .parse(await jsonBody(request, 2000));
  return respond(
    {
      error: {
        code: "login_removed",
        message: "此工作區為免登入單一空間，不接受帳號密碼。",
      },
    },
    410,
  );
});
export const DELETE = route(async (request) => {
  checkOrigin(request);
  return respond(
    {
      error: {
        code: "login_removed",
        message: "此工作區沒有登出流程。",
      },
    },
    410,
  );
});
