"use client";
import { FileText, Link } from "lucide-react";
import type { Material } from "@/lib/contracts";
import {
  isPdfMaterial,
  materialKindLabel,
  materialThumbSrc,
} from "@/lib/client/media";

export default function MaterialCover({
  material,
  fileName,
}: {
  material?: Material | null;
  fileName?: string;
}) {
  if (material?.kind === "image")
    return (
      <img src={materialThumbSrc(material.id)} alt="" loading="lazy" />
    );
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
