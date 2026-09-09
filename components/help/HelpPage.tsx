"use client";

import { RECRUITMENT_TRUTH_NOTICE } from "@/lib/client/recruitment-truth";
import RecruitmentFunnelCard from "@/components/help/RecruitmentFunnelCard";

/** Secondary Help surface — recruitment-truth + P0′ funnel readonly card. */
export default function HelpPage() {
  return (
    <div className="settings-stack help-page">
      <p className="eyebrow">說明</p>
      <h2>招生真相與靈感表</h2>
      <p className="help-recruitment-truth">{RECRUITMENT_TRUTH_NOTICE}</p>
      <p className="muted">
        漏斗契約與 Drive FACT 才是人數／名單真相來源；靈感板與 Sheets sync 僅作文宣參考。
      </p>
      <RecruitmentFunnelCard />
    </div>
  );
}
