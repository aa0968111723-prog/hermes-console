"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean; message: string };

function reportClientError(error: Error, errorInfo: ErrorInfo) {
  const payload = {
    message: error.message,
    stack: error.stack || "",
    componentStack: errorInfo.componentStack || "",
    href: typeof location === "undefined" ? "" : location.href,
    at: new Date().toISOString(),
  };
  console.error("[hermes-console] render crash", payload.message, payload.stack, payload.componentStack);
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/client-error", blob)) return;
    }
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* reporting must never throw */
  }
}

export default class ConsoleErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: Error) {
    return { failed: true, message: error.message || "render_failed" };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportClientError(error, errorInfo);
  }

  render() {
    if (this.state.failed)
      return (
        <main className="app-shell">
          <section className="welcome">
            <p className="eyebrow">Hermes</p>
            <h1>今天想做什麼？</h1>
            <p role="alert">
              工作區讀取失敗。請重新載入頁面；連線未確認時仍可使用此工作區。
            </p>
            {this.state.message ? (
              <pre className="error-detail" role="status">
                {this.state.message}
              </pre>
            ) : null}
            <button className="primary" type="button" onClick={() => location.reload()}>
              重新載入
            </button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
