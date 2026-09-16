"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app-shell">
      <section className="welcome">
        <p className="eyebrow">Hermes</p>
        <h1>畫面讀取失敗</h1>
        <p role="alert">請重新載入這一頁。沒有假裝工作區或 Hermes 仍可用。</p>
        <button className="primary" onClick={reset}>
          重新載入
        </button>
      </section>
    </main>
  );
}
