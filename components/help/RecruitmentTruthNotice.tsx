"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  RECRUITMENT_TRUTH_NOTICE,
  RECRUITMENT_TRUTH_NOTICE_DISMISSED_KEY,
} from "@/lib/client/recruitment-truth";
import { readPreference, writePreference } from "@/lib/client/storage";

/** Inspiration-top soft info · 1 line · foldable + dismissible · not a modal. */
export default function RecruitmentTruthNotice() {
  const [dismissed, setDismissed] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDismissed(readPreference(RECRUITMENT_TRUTH_NOTICE_DISMISSED_KEY) === "1");
    setReady(true);
  }, []);

  if (!ready || dismissed) return null;

  function dismiss() {
    writePreference(RECRUITMENT_TRUTH_NOTICE_DISMISSED_KEY, "1");
    setDismissed(true);
  }

  return (
    <aside className="soft-info-notice" role="status">
      <details open className="soft-info-notice-fold">
        <summary>招生真相說明</summary>
        <p className="soft-info-notice-line">{RECRUITMENT_TRUTH_NOTICE}</p>
      </details>
      <button
        type="button"
        className="soft-info-notice-dismiss"
        aria-label="關閉說明"
        onClick={dismiss}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </aside>
  );
}
