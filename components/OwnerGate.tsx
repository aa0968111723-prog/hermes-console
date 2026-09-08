"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import HermesConsole from "./HermesConsole";

/** 單一擁有者登入閘。未啟用 CONSOLE_REQUIRE_AUTH 時直接放行，不影響既有免登入行為。 */
export default function OwnerGate() {
  const [state, setState] = useState<"loading" | "ready" | "locked">("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/auth", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json().catch(() => ({}));
      if (result.mode !== "owner-login") {
        setState("ready");
        return;
      }
      setState(response.ok && result.signedIn ? "ready" : "locked");
    } catch {
      setState("locked");
      setNotice("無法驗證登入狀態，請檢查網路後重試。");
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "owner_login", username, password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || "帳號或密碼不正確。");
      setPassword("");
      setState("ready");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (state === "loading")
    return (
      <main className="invite-entry">
        <p role="status">正在驗證工作區存取…</p>
      </main>
    );
  if (state === "ready") return <HermesConsole />;
  return (
    <main className="invite-entry">
      <section>
        <h1>內部工作區</h1>
        <p>此工作區僅限一位內部人員使用，請登入擁有者帳號。</p>
        {notice && <p role="status">{notice}</p>}
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label>
            帳號
            <input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            密碼
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "登入中…" : "登入工作區"}
          </button>
        </form>
        <button
          disabled={busy}
          onClick={() => {
            void check();
          }}
        >
          重新檢查存取
        </button>
      </section>
    </main>
  );
}
