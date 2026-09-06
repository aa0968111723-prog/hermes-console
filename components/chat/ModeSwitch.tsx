"use client";

import {
  ASSISTANT_MODE_META,
  ASSISTANT_MODES,
  type AssistantMode,
} from "@/lib/assistant-modes";

export default function ModeSwitch({
  mode,
  onChange,
  disabled = false,
}: {
  mode: AssistantMode;
  onChange: (next: AssistantMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mode-switch" role="radiogroup" aria-label="助手模式">
      {ASSISTANT_MODES.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          disabled={disabled}
          onClick={() => onChange(id)}
        >
          {ASSISTANT_MODE_META[id].label}
        </button>
      ))}
    </div>
  );
}
