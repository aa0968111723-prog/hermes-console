"use client";
import { useEffect, useState } from "react";
import { FileText, Link } from "lucide-react";
import type { Material } from "@/lib/contracts";
import {
  isPdfMaterial,
  materialKindLabel,
  materialThumbSrc,
} from "@/lib/client/media";

function LocalImageCover({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url)
    return (
      <span className="material-cover">
        <FileText size={22} aria-hidden="true" />
        <b>圖片</b>
      </span>
    );
  return <img src={url} alt="" />;
}

export default function MaterialCover({
  material,
  fileName,
  file,
}: {
  material?: Material | null;
  fileName?: string;
  file?: File | null;
}) {
  if (material?.kind === "image")
    return (
      <img src={materialThumbSrc(material.id)} alt="" loading="lazy" />
    );
  if (file?.type.startsWith("image/")) return <LocalImageCover file={file} />;
  const pdf = isPdfMaterial(material, fileName);
  const label = material
    ? materialKindLabel(material, fileName)
    : pdf
      ? "PDF"
      : "文件";
  const Icon = material?.kind === "reference" ? Link : FileText;
  return (
    <span className={"material-cover" + (pdf ? " is-pdf" : "")}>
      <Icon size={22} aria-hidden="true" />
      <b>{label}</b>
    </span>
  );
}
