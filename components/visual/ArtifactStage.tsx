"use client";

import { Layers, MessageSquare, X } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import CanvaResult from "../CanvaResult";

export default function ArtifactStage({
  design,
  onContinue,
}: {
  design: Record<string, unknown>;
  onContinue?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  return (
    <section className="artifact-stage" aria-label="設計成果預覽">
      <header>
        <span>
          <Layers size={16} />
          成果
        </span>
        {onContinue && (
          <button
            className="icon-button"
            aria-label="在對話修改這個作品"
            onClick={onContinue}
          >
            <MessageSquare size={18} />
          </button>
        )}
      </header>
      <CanvaResult design={design} onPreview={()=>setOpen(true)} />
      <dialog ref={dialog} className="artifact-preview" aria-label="作品全螢幕預覽"
        onCancel={()=>setOpen(false)} onClick={e=>{if(e.currentTarget===e.target)setOpen(false);}}>
        <header><h2>作品預覽</h2><button className="icon-button" aria-label="關閉作品預覽" onClick={()=>setOpen(false)}><X size={22}/></button></header>
        {open && <CanvaResult design={design}/>}
      </dialog>
    </section>
  );
}
