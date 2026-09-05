import { z } from "zod";
import {
  authenticate,
  checkOrigin,
  hash,
  jsonBody,
  login,
  respond,
  route,
  sessionCookie,
} from "@/lib/server/security";
import { db } from "@/lib/server/store";
export const runtime = "nodejs";
export const GET = route(async (request) =>
  respond({
    user: { id: authenticate(request), name: process.env.CONSOLE_USERNAME },
  }),
);
export const POST = route(async (request) => {
  checkOrigin(request);
  const input = z
    .object({
      username: z.string().max(100),
      password: z.string().min(1).max(256),
    })
    .strict()
    .parse(await jsonBody(request, 2000));
  const token = login(input.username, input.password);
  return respond({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
});
export const DELETE = route(async (request) => {
  authenticate(request, true);
  const cookie = (request.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("hermes_session="))
    ?.slice(15);
  if (cookie)
    db().prepare("DELETE FROM sessions WHERE digest=?").run(hash(cookie));
  return respond({ ok: true }, 200, { "Set-Cookie": sessionCookie("", true) });
});
