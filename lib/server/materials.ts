import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type {
  Material,
  MaterialSource,
  MaterialSourceProvider,
} from "../contracts";
import { dataDir, get, list, put } from "./store";
import { ApiError, WORKSPACE_OWNER } from "./security";
import { wrapUntrusted } from "./untrusted";
import { canonicalUrl } from "./inspiration/dedupe";

export function material(owner: string, id: string) {
  const value = get<Material>("material", owner, id);
  if (!value) throw new ApiError(404, "not_found", "找不到素材。");
  return value;
}
export function filePath(owner: string, id: string) {
  if (
    ![WORKSPACE_OWNER, "owner"].includes(owner) ||
    !/^[a-f0-9-]{36}$/.test(id)
  )
    throw new ApiError(400, "invalid_id", "素材識別錯誤。");
  return join(dataDir(), "uploads", owner, id);
}

export function includeDuplicatesQuery(url: URL) {
  const value = url.searchParams.get("includeDuplicates");
  return value === "1" || value === "true";
}

export function listMaterials(
  owner: string,
  options: { includeDuplicates?: boolean; projectId?: string } = {},
) {
  return list<Material>("material", owner).filter((entry) => {
    if (options.projectId && entry.projectId !== options.projectId) return false;
    if (!options.includeDuplicates && entry.dedupeStatus === "duplicate")
      return false;
    return true;
  });
}

export function fingerprintBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fingerprintUrl(url: string) {
  return fingerprintBytes(Buffer.from("url\n" + canonicalUrl(url), "utf8"));
}

function dualWriteRights(rights: Material["rights"], license?: string) {
  const resolvedLicense = license || rights;
  const resolvedRights: Material["rights"] =
    resolvedLicense === "reference_only" || rights === "reference_only"
      ? "reference_only"
      : "user_provided";
  return { rights: resolvedRights, license: resolvedLicense };
}

function primaryForFingerprint(owner: string, fingerprint: string) {
  return list<Material>("material", owner)
    .filter(
      (entry) =>
        entry.contentSha256 === fingerprint &&
        entry.dedupeStatus !== "duplicate",
    )
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )[0];
}

function assertProject(owner: string, projectId: string) {
  if (projectId !== "personal" && !get("project", owner, projectId))
    throw new ApiError(404, "project_not_found", "專案不存在。");
}

function normalizePeople(people?: string[]) {
  if (!people?.length) return undefined;
  const cleaned = people
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((value) => value.slice(0, 20));
  return cleaned.length ? cleaned : undefined;
}

function withDedupe(
  owner: string,
  fingerprint: string,
  record: Material,
): Material {
  const { rights, license } = dualWriteRights(record.rights, record.license);
  const primary = primaryForFingerprint(owner, fingerprint);
  const duplicate = !!(primary && primary.id !== record.id);
  return {
    ...record,
    rights,
    license,
    people: normalizePeople(record.people),
    contentSha256: fingerprint,
    duplicateOf: duplicate ? primary.id : null,
    dedupeStatus: duplicate ? "duplicate" : "primary",
  };
}

export function parseDriveSource(url: string): MaterialSource | null {
  let parsed: URL;
  try {
    parsed = new URL(canonicalUrl(url));
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const sheets = parsed.pathname.includes("/spreadsheets/");
  const drive =
    host === "drive.google.com" ||
    host === "docs.google.com" ||
    host === "sheets.google.com";
  if (!drive) return null;
  const id = parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  return {
    type: "drive_fact",
    locator: id || parsed.toString(),
    provider: sheets ? "sheets" : "google_drive",
  };
}

export function sourceForRemoteUrl(
  url: string,
  inspirationPlatform?: string,
): MaterialSource {
  const drive = parseDriveSource(url);
  if (drive) return drive;
  if (inspirationPlatform) {
    const provider: MaterialSourceProvider | undefined =
      inspirationPlatform === "instagram" ||
      inspirationPlatform === "pinterest"
        ? inspirationPlatform
        : undefined;
    return {
      type: "inspiration",
      locator: canonicalUrl(url),
      provider,
    };
  }
  return { type: "web_https", locator: canonicalUrl(url) };
}

export function saveLinkedMaterial(input: {
  owner: string;
  projectId: string;
  title: string;
  url: string;
  notes: string;
  tags?: string[];
  source: MaterialSource;
}): Material {
  assertProject(input.owner, input.projectId);
  const url = canonicalUrl(input.url);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new ApiError(
      400,
      "unsafe_link",
      "請貼上不含帳密的 HTTPS 來源連結。",
    );
  const fingerprint = fingerprintUrl(url);
  return put(
    "material",
    input.owner,
    withDedupe(input.owner, fingerprint, {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title.slice(0, 150),
      kind: "reference",
      url,
      mime: null,
      bytes: null,
      tags: (input.tags || []).slice(0, 10),
      createdAt: new Date().toISOString(),
      rights: "reference_only",
      license: "reference_only",
      notes: input.notes,
      source: input.source,
      format: "url/https",
    }),
  );
}

export function saveReference(
  owner: string,
  input: {
    projectId: string;
    title: string;
    url: string;
    notes: string;
    tags: string[];
  },
) {
  return saveLinkedMaterial({
    owner,
    projectId: input.projectId,
    title: input.title,
    url: input.url,
    notes: input.notes,
    tags: input.tags,
    source: { type: "web_https", locator: canonicalUrl(input.url) },
  });
}

export function ingestDriveFact(input: {
  owner: string;
  projectId: string;
  title: string;
  locator: string;
  notes?: string;
}) {
  const href = /^https:/i.test(input.locator)
    ? input.locator
    : "https://drive.google.com/file/d/" + input.locator + "/view";
  return saveLinkedMaterial({
    owner: input.owner,
    projectId: input.projectId,
    title: input.title,
    url: href,
    notes: input.notes || "Drive 事實紀錄；僅保存定位，未改寫 Drive。",
    source:
      parseDriveSource(href) || {
        type: "drive_fact",
        locator: input.locator,
        provider: "google_drive",
      },
  });
}
export async function saveUpload(
  owner: string,
  projectId: string,
  name: string,
  mime: string,
  bytes: Buffer,
) {
  if (
    list<Material>("material", owner).reduce(
      (sum, m) => sum + (m.bytes || 0),
      0,
    ) +
      bytes.length >
    250_000_000
  )
    throw new ApiError(
      413,
      "storage_limit",
      "素材已達 250 MB 限額，請由管理者整理備份。",
    );
  assertProject(owner, projectId);
  let content: Buffer;
  let outputMime: string;
  let kind: Material["kind"];
  if (["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    try {
      content = await sharp(bytes, {
        limitInputPixels: 25_000_000,
        animated: false,
      })
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
    } catch {
      throw new ApiError(
        400,
        "invalid_image",
        "圖片無法讀取，請使用 25 百萬像素以內的 PNG、JPEG 或 WebP。",
      );
    }
    outputMime = "image/png";
    kind = "image";
  } else if (mime === "text/plain") {
    if (bytes.length > 100_000)
      throw new ApiError(413, "text_too_large", "文字檔上限 100 KB。");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ApiError(400, "invalid_text", "文字檔需為 UTF-8。");
    }
    content = bytes;
    outputMime = mime;
    kind = "text";
  } else if (mime === "application/pdf") {
    if (bytes.length > 8_000_000)
      throw new ApiError(413, "pdf_too_large", "PDF 上限 8 MB。");
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
      throw new ApiError(400, "invalid_pdf", "PDF 檔案格式不正確。");
    content = bytes;
    outputMime = mime;
    kind = "text";
  } else
    throw new ApiError(
      415,
      "unsupported_file",
      "僅支援 PNG、JPEG、WebP、UTF-8 TXT 與 PDF。",
    );
  const id = randomUUID();
  await mkdir(join(dataDir(), "uploads", owner), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(filePath(owner, id), content, { flag: "wx", mode: 0o600 });
  const fingerprint = fingerprintBytes(content);
  return put(
    "material",
    owner,
    withDedupe(owner, fingerprint, {
      id,
      projectId,
      title: name.slice(0, 150),
      kind,
      url: null,
      mime: outputMime,
      bytes: content.length,
      tags: [],
      createdAt: new Date().toISOString(),
      rights: "user_provided",
      license: "user_provided",
      notes: "使用者上傳；公開發佈前仍需确认權利。",
      source: { type: "upload", provider: "hermes_upload" },
      format: outputMime,
    }),
  );
}
export async function attachmentParts(owner: string, ids: string[]) {
  const parts: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const asset = material(owner, id);
    if (asset.kind === "reference") {
      parts.push({
        type: "text",
        text: wrapUntrusted(
          "reference",
          `參考連結（使用前需查證）：${asset.url}\n${asset.notes}`,
        ),
      });
      continue;
    }
    const content = await readFile(filePath(owner, id));
    if (asset.kind === "image") {
      if (process.env.HERMES_IMAGE_INPUT !== "true")
        throw new ApiError(
          409,
          "images_unverified",
          "圖片已保存，但部署端尚未驗證圖片輸入。請完成設定後重新傳送。",
        );
      parts.push({
        type: "image_url",
        image_url: {
          url: "data:image/png;base64," + content.toString("base64"),
        },
      });
    } else
      parts.push({
        type: "text",
        text:
          asset.mime === "application/pdf"
            ? wrapUntrusted(
                "pdf",
                `PDF 附件「${asset.title}」已保存；此部署不保證全文解析，不得把檔名當內容。`,
              )
            : wrapUntrusted("attachment", content.toString("utf8")),
      });
  }
  return parts;
}
