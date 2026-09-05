import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  ApiError,
  authenticate,
  jsonBody,
  respond,
  route,
} from "@/lib/server/security";
import { get, put } from "@/lib/server/store";
import { filePath, material, saveUpload } from "@/lib/server/materials";
import type { Material } from "@/lib/contracts";
export const runtime = "nodejs";
const projectSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
function verifyProject(owner: string, id: string) {
  if (id !== "personal" && !get("project", owner, id))
    throw new ApiError(404, "project_not_found", "專案不存在。");
}
export const GET = route(async (req) => {
  const owner = authenticate(req),
    id = z.string().uuid().parse(new URL(req.url).searchParams.get("id"));
  const asset = material(owner, id);
  if (asset.kind === "reference") return respond({ material: asset });
  return new Response(new Uint8Array(await readFile(filePath(owner, id))), {
    headers: {
      "Content-Type": asset.mime || "application/octet-stream",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.title)}`,
    },
  });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const type = req.headers.get("content-type")?.split(";")[0] || "";
  if (type === "application/json") {
    const body = z
      .object({
        projectId: projectSchema.default("personal"),
        title: z.string().trim().min(1).max(150),
        url: z.string().url().max(2000),
        notes: z.string().max(4000).default(""),
        tags: z.array(z.string().max(30)).max(10).default([]),
      })
      .strict()
      .parse(await jsonBody(req));
    verifyProject(owner, body.projectId);
    const url = new URL(body.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new ApiError(
        400,
        "unsafe_link",
        "請貼上不含帳密的 HTTPS 來源連結。",
      );
    const record: Material = {
      ...body,
      id: randomUUID(),
      kind: "reference",
      mime: null,
      bytes: null,
      createdAt: new Date().toISOString(),
      rights: "reference_only",
    };
    // Save a reference, never fetch an arbitrary user-supplied URL on this server.
    return respond({ material: put("material", owner, record) }, 201);
  }
  const projectId = projectSchema.parse(
    new URL(req.url).searchParams.get("projectId") || "personal",
  );
  verifyProject(owner, projectId);
  if (!["image/png", "image/jpeg", "image/webp", "text/plain"].includes(type))
    throw new ApiError(
      415,
      "unsupported_file",
      "支援 PNG、JPEG、WebP 與 TXT。",
    );
  const max = 8_000_000;
  if (Number(req.headers.get("content-length")) > max)
    throw new ApiError(413, "upload_limit", "檔案上限 8 MB。");
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_file", "檔案沒有內容。");
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new ApiError(413, "upload_limit", "檔案上限 8 MB。");
    }
    parts.push(value);
  }
  let name = "上傳素材";
  try {
    name = decodeURIComponent(req.headers.get("x-file-name") || name);
  } catch {}
  return respond(
    {
      material: await saveUpload(
        owner,
        projectId,
        name,
        type,
        Buffer.concat(parts),
      ),
    },
    201,
  );
});
