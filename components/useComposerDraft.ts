"use client";
import { useState, type SetStateAction } from "react";
import type { Material, TaskFocus } from "@/lib/contracts";

export type Upload = {
  key: string;
  file: File;
  progress: number;
  error: string | null;
  material?: Material;
};
export type ComposerDraft = {
  text: string;
  uploads: Upload[];
  references: string[];
  focus: TaskFocus | null;
};
export const emptyDraft = (): ComposerDraft => ({
  text: "",
  uploads: [],
  references: [],
  focus: null,
});

// Only kept in this tab's memory. Each asynchronous upload retains its original
// scope, so switching conversations cannot attach it to a different project.
export function useComposerDraft(scope: string) {
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>({});
  const draft = drafts[scope] || emptyDraft();
  function updateField<K extends keyof ComposerDraft>(
    field: K,
    value: SetStateAction<ComposerDraft[K]>,
  ) {
    setDrafts((old) => {
      const current = old[scope] || emptyDraft();
      const next = typeof value === "function" ? value(current[field]) : value;
      return { ...old, [scope]: { ...current, [field]: next } };
    });
  }
  function replaceDraft(key: string, value: ComposerDraft) {
    setDrafts((old) => ({ ...old, [key]: value }));
  }
  return {
    ...draft,
    draft,
    replaceDraft,
    setText: (value: SetStateAction<string>) => updateField("text", value),
    setUploads: (value: SetStateAction<Upload[]>) =>
      updateField("uploads", value),
    setReferences: (value: SetStateAction<string[]>) =>
      updateField("references", value),
    setFocus: (value: SetStateAction<TaskFocus | null>) =>
      updateField("focus", value),
    clearDrafts: () => setDrafts({}),
  };
}
