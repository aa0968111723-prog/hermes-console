"use client";

export default function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="welcome-overlay" role="dialog" aria-label="歡迎">
      <p className="eyebrow">HERMES CREATIVE INTELLIGENCE</p>
      <h2>歡迎使用 Hermes Creative Intelligence</h2>
      <p>直接告訴龜龜你想做什麼。</p>
      <div className="welcome-actions">
        <button className="primary" onClick={onStart}>
          開始使用
        </button>
        <button className="text-button" onClick={onStart}>
          略過
        </button>
      </div>
    </div>
  );
}
