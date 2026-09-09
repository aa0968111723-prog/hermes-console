"use client";

import { RECRUITMENT_TRUTH_NOTICE } from "@/lib/client/recruitment-truth";

/** Secondary Help surface — same recruitment-truth sentence; not the primary Inspiration notice. */
export default function HelpPage() {
  return (
    <div className="settings-stack help-page">
      <p className="eyebrow">說明</p>
      <h2>招生真相與靈感表</h2>
      <p className="help-recruitment-truth">{RECRUITMENT_TRUTH_NOTICE}</p>
      <p className="muted">
        漏斗契約與 Drive FACT 才是人數／名單真相來源；靈感板與 Sheets sync 僅作文宣參考。
      </p>
    </div>
  );
}
