import test from "node:test";
import assert from "node:assert/strict";
import {
  isPdfMaterial,
  materialKindLabel,
  materialThumbSrc,
} from "../lib/client/media";

test("visual context labels thumbnails, PDFs and links without claiming a website scrape", () => {
  assert.equal(
    materialThumbSrc("11111111-1111-1111-1111-111111111111"),
    "/api/materials?id=11111111-1111-1111-1111-111111111111&variant=thumb",
  );
  assert.equal(
    materialKindLabel({
      kind: "image",
      mime: "image/png",
      title: "海報.png",
      url: null,
    }),
    "圖片",
  );
  assert.equal(
    isPdfMaterial({ mime: "application/pdf", title: "簡章.pdf" }),
    true,
  );
  assert.equal(
    materialKindLabel({
      kind: "text",
      mime: "application/pdf",
      title: "簡章.pdf",
      url: null,
    }),
    "PDF",
  );
  assert.equal(
    materialKindLabel({
      kind: "reference",
      mime: null,
      title: "外部海報",
      url: "https://www.example.com/poster",
    }),
    "example.com",
  );
});
