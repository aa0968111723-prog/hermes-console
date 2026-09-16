"use client";

import { Download, ExternalLink } from "lucide-react";
import type { Material } from "@/lib/contracts";
import { materialSrc, referenceHost } from "@/lib/client/material-src";
import { formatWorkspaceTime } from "@/lib/client/workspace-ui";

export default function PreviewPanel({ preview }: { preview: Material }) {
  return (
    <div className="settings-stack">
      <h3>{preview.title}</h3>
      {preview.kind === "image" && (
        <img
          className="full-preview"
          src={materialSrc(preview.id, "full")}
          alt={preview.title}
        />
      )}
      {preview.mime === "application/pdf" && (
        <figure className="pdf-cover">
          <img
            className="full-preview"
            src={materialSrc(preview.id, "thumb")}
            alt={preview.title + "（PDF 標示封面，非頁面擷取）"}
          />
          <figcaption>PDF 標示封面，不是頁面擷取</figcaption>
        </figure>
      )}
      {preview.kind === "reference" && preview.url && (
        <p className="material-tile preview-host">
          <strong>{referenceHost(preview.url)}</strong>
          <small>未抓取網站預覽，避免伺服器代打任意網址。</small>
        </p>
      )}
      <p>
        {preview.rights === "reference_only"
          ? "參考用途；使用權利未確認。"
          : "使用者提供素材，發佈前請確認使用權利。"}
      </p>
      <p>{preview.notes}</p>
      {preview.url ? (
        <a
          className="button-link"
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          開啟原始來源 <ExternalLink size={16} />
        </a>
      ) : (
        <a
          className="button-link"
          href={materialSrc(preview.id, "full")}
          download={preview.title}
        >
          下載素材 <Download size={16} />
        </a>
      )}
      <small>保存時間：{formatWorkspaceTime(preview.createdAt)}</small>
    </div>
  );
}
