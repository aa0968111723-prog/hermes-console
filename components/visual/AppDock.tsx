"use client";
import { useRef } from "react";
import {
  Bot,
  Images,
  MessageSquare,
  Sparkles,
  ListTodo,
  ImagePlus,
  FileText,
  Palette,
  Brain,
  X,
  Leaf,
} from "lucide-react";
type Nav = "chat" | "projects" | "inspiration" | "agents" | "tasks";
export default function AppDock({
  nav,
  onNavigate,
  onAction,
  onFiles,
  busy,
  onOpenChange,
}: {
  nav: Nav;
  onNavigate: (nav: Nav) => void;
  onAction: (action: "spatial" | "memory" | "canva") => void;
  onFiles: (files: File[]) => void;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const close = () => {
    sheet.current?.close();
    trigger.current?.focus({preventScroll:true});
    onOpenChange(false);
  };
  const action = (next: "spatial" | "memory" | "canva") => {
    close();
    onAction(next);
  };
  const file = (kind: "image" | "document") => {
    if (input.current) {
      input.current.accept =
        kind === "image"
          ? "image/png,image/jpeg,image/webp"
          : "text/plain,application/pdf";
      input.current.click();
    }
  };
  return (
    <>
      <nav className="mobile-bottom-dock spatial-dock" aria-label="快速導覽">
        <button
          aria-label="對話"
          aria-current={nav === "chat" ? "page" : undefined}
          onClick={() => onNavigate("chat")}
        >
          <MessageSquare size={21} />
          <span>對話</span>
        </button>
        <button
          aria-label="靈感"
          aria-current={nav === "inspiration" ? "page" : undefined}
          onClick={() => onNavigate("inspiration")}
        >
          <Sparkles size={21} />
          <span>靈感</span>
        </button>
        <button
        className="dock-core"
        ref={trigger}
          aria-label="Hermes 操作"
          aria-haspopup="dialog"
        onClick={() => {
          trigger.current?.focus({preventScroll:true});
            sheet.current?.showModal();
            onOpenChange(true);
          }}
        >
          <span>
            <Leaf size={25} />
          </span>
          <span className="sr-only">Hermes</span>
        </button>
        <button
          aria-label="專案"
          aria-current={nav === "projects" ? "page" : undefined}
          onClick={() => onNavigate("projects")}
        >
          <Images size={21} />
          <span>專案</span>
        </button>
        <button
          aria-label="任務"
          aria-current={nav === "tasks" ? "page" : undefined}
          onClick={() => onNavigate("tasks")}
        >
          <ListTodo size={21} />
          <span>任務</span>
        </button>
      </nav>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        aria-label="從 Hermes 加入檔案"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          close();
          onFiles(files);
        }}
      />
      <dialog
        ref={sheet}
        className="radial-sheet"
        aria-labelledby="hermes-actions-title"
        onClose={() => onOpenChange(false)}
        onCancel={() => onOpenChange(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <header>
          <h2 id="hermes-actions-title">Hermes</h2>
          <button
            className="icon-button"
            aria-label="關閉 Hermes 操作"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <div
          className="radial-actions"
          role="group"
          aria-label="Hermes 快捷操作"
        >
          <button onClick={() => file("image")} disabled={busy}>
            <ImagePlus size={24} />
            圖片
          </button>
          <button onClick={() => action("spatial")}>
            <Bot size={24} />
            能力
          </button>
          <span className="radial-center" aria-hidden="true">
            <Leaf size={30} />
          </span>
          <button onClick={() => action("canva")} disabled={busy}>
            <Palette size={24} />
            Canva
          </button>
          <button onClick={() => file("document")} disabled={busy}>
            <FileText size={24} />
            文件
          </button>
          <button onClick={() => action("memory")}>
            <Brain size={24} />
            記憶
          </button>
        </div>
      </dialog>
    </>
  );
}
