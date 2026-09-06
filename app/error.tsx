"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app-shell">
      <section className="welcome">
        <p className="eyebrow">歡迎使用 Hermes Creative Intelligence</p>
        <h1>今天想做什麼？</h1>
        <p role="alert">工作區讀取失敗。Hermes 尚未連線時仍可使用此工作區。</p>
        <button className="primary" onClick={reset}>
          重新載入
        </button>
      </section>
    </main>
  );
}
