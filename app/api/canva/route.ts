import { z } from "zod";
import {
  authenticate,
  jsonBody,
  respond,
  route,
} from "@/lib/server/security";
import {
  canvaStatus,
  startCanvaAuth,
  verifyCanva,
  searchDesigns,
  getCanvaDesign,
  createCanvaDesign,
  exportCanvaDesign,
  pollCanvaExport,
  readDataset,
} from "@/lib/server/canva";

export const runtime = "nodejs";

export const GET = route(async (req) =>
  respond(canvaStatus(authenticate(req))),
);

export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const body = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("authorize") }),
      z.object({ action: z.literal("verify") }),
      z.object({ action: z.literal("search_designs"), query: z.string().max(150).optional() }),
      z.object({ action: z.literal("get_design"), designId: z.string().regex(/^[a-zA-Z0-9_-]+$/) }),
      z.object({
        action: z.literal("create_design"),
        title: z.string().min(1).max(100),
        designType: z
          .union([
            z.object({ type: z.literal("preset"), name: z.string() }),
            z.object({ type: z.literal("custom"), width: z.number().int().positive(), height: z.number().int().positive() }),
          ])
          .optional(),
      }),
      z.object({
        action: z.literal("export_design"),
        designId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
        format: z.enum(["png", "jpg", "pdf"]).optional(),
        quality: z.number().min(1).max(100).optional(),
      }),
      z.object({
        action: z.literal("poll_export"),
        exportJobId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
      }),
      z.object({
        action: z.literal("template_dataset"),
        templateId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
      }),
    ])
    .parse(await jsonBody(req));

  switch (body.action) {
    case "verify":
      return respond(await verifyCanva(owner));
    case "authorize": {
      const auth = startCanvaAuth(owner);
      // Lax one-use state cookie allows the cross-site OAuth callback; the main session stays Strict.
      return respond({ url: auth.url }, 200, {
        "Set-Cookie": `canva_oauth=${auth.state}; HttpOnly; SameSite=Lax; Path=/api/canva; Max-Age=600${process.env.CONSOLE_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`,
      });
    }
    case "search_designs":
      return respond(await searchDesigns(owner, body.query));
    case "get_design":
      return respond(await getCanvaDesign(owner, body.designId));
    case "create_design":
      return respond(await createCanvaDesign(owner, { title: body.title, designType: body.designType }));
    case "export_design":
      return respond(await exportCanvaDesign(owner, { designId: body.designId, format: body.format, quality: body.quality }));
    case "poll_export":
      return respond(await pollCanvaExport(owner, body.exportJobId));
    case "template_dataset":
      return respond(await readDataset(owner, body.templateId));
  }
});

