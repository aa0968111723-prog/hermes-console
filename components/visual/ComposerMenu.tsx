"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, ImagePlus, FileText, Link, Palette, Folder } from "lucide-react";
export default function ComposerMenu({
  disabled,
  onUpload,
  onNavigate,
}: {
  disabled: boolean;
  onUpload: (kind: "image" | "document") => void;
  onNavigate: (kind: "reference" | "canva" | "project") => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="composer-menu"
      ref={container}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="icon-button"
        aria-label="加入內容"
        aria-expanded={open}
        aria-controls="composer-add-menu"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Plus size={23} />
      </button>
      {open && (
        <div
          id="composer-add-menu"
          className="composer-popover"
          role="group"
          aria-label="加入內容選項"
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onUpload("image");
            }}
          >
            <ImagePlus size={18} />
            圖片
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onUpload("document");
            }}
          >
            <FileText size={18} />
            文件
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNavigate("reference");
            }}
          >
            <Link size={18} />
            參考連結
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNavigate("canva");
            }}
          >
            <Palette size={18} />
            Canva
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNavigate("project");
            }}
          >
            <Folder size={18} />
            專案素材
          </button>
          <small>
            PNG / JPG / WebP / TXT / PDF
            <br />
            每檔 8 MB，每則最多 4 個附件
          </small>
        </div>
      )}
    </div>
  );
}
