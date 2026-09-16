"use client";
import { FileText, Link } from "lucide-react";
import type { Material } from "@/lib/contracts";
import { attachmentCoverKind, attachmentKindLabel } from "@/lib/client/attachments";

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
        src={"/api/materials?id=" + material.id}
        alt={alt || material.title}
      />
    );
  const Icon = kind === "link" ? Link : FileText;
  return (
    <span className={"attachment-cover is-" + kind} aria-hidden>
      <Icon size={24} />
      <em>{attachmentKindLabel(material)}</em>
    </span>
  );
}
