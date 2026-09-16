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
            <h1>今天想做什麼？</h1>
            <p role="alert">工作區讀取失敗。請重新載入頁面；連線未確認時仍可使用此工作區。</p>
          </section>
        </main>
      );
    return this.props.children;
  }
}
