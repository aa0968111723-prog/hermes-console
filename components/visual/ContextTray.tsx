"use client";
import { Check, FileText, Link, RefreshCw, X } from "lucide-react";
import type { Material } from "@/lib/contracts";
import type { Upload } from "../useComposerDraft";
export default function ContextTray({
  uploads,
  references,
  materials,
  disabled,
  onPreview,
  onRetry,
  onRemoveUpload,
  onRemoveReference,
}: {
  uploads: Upload[];
  references: string[];
  materials: Material[];
  disabled: boolean;
  onPreview: (material: Material) => void;
  onRetry: (upload: Upload) => void;
  onRemoveUpload: (key: string) => void;
  onRemoveReference: (id: string) => void;
}) {
  if (!uploads.length && !references.length) return null;
  return (
    <div className="upload-list context-tray" aria-label="對話素材">
      {uploads.map((upload) => (
        <div className="upload-chip context-card" key={upload.key}>
          <button
            className="context-preview"
            type="button"
            disabled={!upload.material}
            aria-label={"預覽附件：" + upload.file.name}
            onClick={() => upload.material && onPreview(upload.material)}
          >
            {upload.material?.kind === "image" ? (
              <img
                src={"/api/materials?id=" + upload.material.id}
                alt={upload.file.name}
              />
            ) : (
              <FileText size={24} />
            )}
          </button>
          <span title={upload.file.name}>
            {upload.file.name}
            <small role={upload.error ? "alert" : "status"}>
              {upload.error ||
                (upload.material ? (
                  <>
                    <Check size={12} />
                    已保存
                  </>
                ) : (
                  "上傳 " + upload.progress + "%"
                ))}
            </small>
            {!upload.material && !upload.error && (
              <progress
                value={upload.progress}
                max={100}
                aria-label="上傳進度"
              />
            )}
          </span>
          {upload.error && (
            <button
              type="button"
              aria-label="重試上傳"
              disabled={disabled}
              onClick={() => onRetry(upload)}
            >
              <RefreshCw size={16} />
            </button>
          )}
          <button
            type="button"
            aria-label="移除附件"
            disabled={disabled}
            onClick={() => onRemoveUpload(upload.key)}
          >
            <X size={16} />
          </button>
        </div>
      ))}
      {references.map((id) => {
        const material = materials.find((item) => item.id === id);
        return (
          <div className="upload-chip context-card" key={id}>
            <button
              className="context-preview"
              type="button"
              disabled={!material}
              aria-label={"預覽參考：" + (material?.title || "素材已移除")}
              onClick={() => material && onPreview(material)}
            >
              {material?.kind === "image" ? (
                <img src={"/api/materials?id=" + id} alt={material.title} />
              ) : (
                <Link size={24} />
              )}
            </button>
            <span>
              {material?.title || "素材已移除"}
              <small>
                {material?.rights === "reference_only"
                  ? "僅供參考"
                  : "專案素材"}
              </small>
            </span>
            <button
              type="button"
              aria-label="移除參考"
              disabled={disabled}
              onClick={() => onRemoveReference(id)}
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
