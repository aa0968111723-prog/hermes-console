"use client";

import { WORKSPACE_LOAD_NOTICE } from "@/lib/client/workspace-state";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app-shell">
      <section className="welcome">
        <p className="eyebrow">Hermes</p>
        <h1>今天想做什麼？</h1>
        <p role="alert">{WORKSPACE_LOAD_NOTICE}</p>
        <button className="primary" onClick={reset}>
          繼續使用此工作區
        </button>
      </section>
    </main>
  );
}
