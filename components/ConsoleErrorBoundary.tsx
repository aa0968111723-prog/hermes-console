"use client";
import { Component, type ReactNode } from "react";

export default class ConsoleErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="app-shell">
          <section className="welcome">
            <p className="eyebrow">Hermes</p>
            <h1>畫面讀取失敗</h1>
            <p role="alert">請重新載入這一頁。沒有假裝工作區或 Hermes 仍可用。</p>
          </section>
        </main>
      );
    return this.props.children;
  }
}
