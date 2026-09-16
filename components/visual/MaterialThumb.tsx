"use client";
import { useEffect, useState } from "react";
import { FileText, Link } from "lucide-react";
import type { Material } from "@/lib/contracts";
import {
  materialSrc,
  referenceHost,
  visualKind,
} from "@/lib/client/material-src";

export default function MaterialThumb({
  material,
  alt,
  file,
  variant = "thumb",
}: {
  material?: Pick<Material, "id" | "kind" | "mime" | "url" | "title"> | null;
  alt: string;
  file?: File | null;
  variant?: "thumb" | "full";
}) {
  const [localSrc, setLocalSrc] = useState<string | null>(null);
  useEffect(() => {
    if (material?.id || !file?.type.startsWith("image/")) {
      setLocalSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file, material?.id]);
  const kind = visualKind(material);
  if (kind === "image" || localSrc) {
    const src =
      localSrc || (material?.id ? materialSrc(material.id, variant) : "");
    if (!src) return <FileText size={24} aria-hidden />;
    return (
      <img src={src} alt={alt} loading="lazy" decoding="async" />
    );
  }
  if (kind === "pdf" && material?.id) {
    return (
      <img
        src={materialSrc(material.id, "thumb")}
        alt={alt + "（PDF 標示封面，非頁面擷取）"}
        loading="lazy"
        decoding="async"
      />
    );
  }
  if (kind === "link") {
    return (
      <span className="material-tile">
        <Link size={18} aria-hidden />
        <em>{referenceHost(material?.url)}</em>
      </span>
    );
  }
  return <FileText size={24} aria-hidden />;
}
