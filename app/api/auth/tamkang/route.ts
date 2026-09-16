import { ApiError, route } from "@/lib/server/security";
import { optionalUser } from "@/lib/server/identity";
import { tamkangStart } from "@/lib/server/auth-tamkang";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "link" ? "link" : "login";
  if (mode === "link") {
    const user = optionalUser(req);
    if (!user) throw new ApiError(401, "sign_in_required", "請先登入 Hermes。");
    return Response.redirect(await tamkangStart(user.id), 302);
  }
  return Response.redirect(await tamkangStart(), 302);
});
