"use client";
import { FileText } from "lucide-react";
import type { Material } from "@/lib/contracts";
import {
  attachmentCoverKind,
  attachmentCoverMark,
  attachmentKindLabel,
} from "@/lib/client/attachments";

export default function AttachmentCover({
  material,
  alt,
}: {
  material: Material | null | undefined;
  alt?: string;
}) {
  if (!material)
    return (
      <span className="attachment-cover is-file" aria-hidden>
        <FileText size={24} />
      </span>
    );
  const kind = attachmentCoverKind(material);
  if (kind === "image")
    return (
      <img
        className="attachment-cover is-image"
        src={"/api/materials?id=" + material.id + "&thumb=1"}
        alt={alt || material.title}
      />
    );
  if (kind === "link")
    return (
      <span className="attachment-cover is-link" aria-hidden>
        <strong className="attachment-mark">
          {attachmentCoverMark(material)}
        </strong>
        <em>{attachmentKindLabel(material)}</em>
      </span>
    );
  return (
    <span className="attachment-cover is-file" aria-hidden>
      <FileText size={24} />
      <em>{attachmentKindLabel(material)}</em>
    </span>
  );
}
