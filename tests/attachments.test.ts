import test from "node:test";
import assert from "node:assert/strict";
import type { Material } from "../lib/contracts";
import {
  attachmentCoverKind,
  attachmentCoverMark,
  attachmentKindLabel,
} from "../lib/client/attachments";

function material(partial: Partial<Material> & Pick<Material, "kind">): Material {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "personal",
    title: "素材",
    url: null,
    mime: null,
    bytes: null,
    tags: [],
    createdAt: new Date().toISOString(),
    rights: "user_provided",
    notes: "",
    ...partial,
  };
}

test("attachment covers prefer thumbnail / kind, not a bare filename", () => {
  const image = material({ kind: "image", title: "poster.png", mime: "image/png" });
  assert.equal(attachmentCoverKind(image), "image");
  assert.equal(attachmentKindLabel(image), "圖片");

  const pdf = material({
    kind: "text",
    title: "brief.pdf",
    mime: "application/pdf",
  });
  assert.equal(attachmentCoverKind(pdf), "pdf");
  assert.equal(attachmentKindLabel(pdf), "PDF");

  const link = material({
    kind: "reference",
    title: "some-long-slug-that-is-not-the-cover",
    url: "https://www.tku.edu.tw/event",
    rights: "reference_only",
  });
  assert.equal(attachmentCoverKind(link), "link");
  assert.equal(attachmentKindLabel(link), "tku.edu.tw");
  assert.equal(attachmentCoverMark(link), "T");
});
