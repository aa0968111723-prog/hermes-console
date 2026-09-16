"use client";

import { useEffect, useState } from "react";
import Turtle from "./Turtle";

type Providers = {
  google: { configured: boolean; label: string };
  tamkang: { configured: boolean; label: string };
  email: { configured: boolean; mail: boolean; label: string };
};

type Mode = "login" | "register" | "magic" | "forgot" | "reset" | "verify";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [tokenKind, setTokenKind] = useState<"redeem" | "verify" | "reset" | "">(
    "",
  );
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const session = await fetch("/api/auth", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15_000),
      });
      if (session.ok) {
        setSignedIn(true);
        setReady(true);
        return;
      }
      const listed = await fetch("/api/auth?view=providers", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15_000),
      });
      if (listed.ok) setProviders((await listed.json()).providers);
      setSignedIn(false);
    } catch {
      setNotice("無法確認登入狀態，請檢查網路。");
      setSignedIn(false);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const authError = params.get("auth_error");
    if (authError) {
      setNotice(authError);
      window.history.replaceState(null, "", window.location.pathname);
    }
    const login = hash.get("login") || "";
    const verify = hash.get("verify") || "";
    const reset = hash.get("reset") || "";
    if (/^[a-f0-9]{64}$/.test(login)) {
      setMode("verify");
      setTokenKind("redeem");
      setToken(login);
      setNotice("按下確認才會使用一次性登入連結。");
    } else if (/^[a-f0-9]{64}$/.test(verify)) {
      setMode("verify");
      setTokenKind("verify");
      setToken(verify);
      setNotice("按下確認完成電子信箱驗證。");
    } else if (/^[a-f0-9]{64}$/.test(reset)) {
      setMode("reset");
      setTokenKind("reset");
      setToken(reset);
      setNotice("設定新密碼。");
    }
    if (login || verify || reset)
      window.history.replaceState(null, "", window.location.pathname);
    void refresh();
  }, []);

  async function submit(action: string) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "register"
            ? { action, email, password, name }
            : action === "login"
              ? { action, email, password }
              : {
                  action: action === "forgot" ? "forgot" : "request_link",
                  email,
                },
        ),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "無法完成。");
      if (result.signedIn) {
        setSignedIn(true);
        return;
      }
      setNotice(result.message || "請查看信箱。");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmToken(kind: "redeem" | "verify" | "reset") {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "reset"
            ? { action: "reset", token, password }
            : { action: kind, token },
        ),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "無法完成。");
      if (result.signedIn) setSignedIn(true);
      else setNotice(result.message || "請查看信箱。");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready)
    return (
      <main className="login-screen">
        <p role="status">正在確認身分…</p>
      </main>
    );
  if (signedIn) return <>{children}</>;

  const google = providers?.google.configured;
  const tamkang = providers?.tamkang.configured;

  return (
    <main className="login-screen" data-testid="login-screen">
      <section className="login-card">
        <Turtle
          animation
          size={120}
          offline={false}
          onClick={() => undefined}
          label="Hermes"
        />
        <h1>登入 Hermes</h1>
        <p className="muted">先登入，再把想法交給龜龜。</p>
        {notice && (
          <p className="error" role="alert">
            {notice}
          </p>
        )}
        <div className="login-providers">
          {google ? (
            <a className="primary" href="/api/auth/google">
              使用 Google 登入
            </a>
          ) : (
            <p className="muted">{providers?.google.label || "Google 登入尚未完成設定"}</p>
          )}
          {tamkang ? (
            <a href="/api/auth/tamkang">使用淡江 SSO</a>
          ) : (
            <p className="muted">
              {providers?.tamkang.label || "淡江 SSO 尚未完成設定"}
            </p>
          )}
        </div>
        {mode === "register" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit("register");
            }}
          >
            <label>
              名稱
              <input
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label>
              電子信箱
              <input
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              密碼
              <input
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "處理中…" : "建立帳號"}
            </button>
          </form>
        ) : mode === "magic" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit("request_link");
            }}
          >
            <label>
              電子信箱
              <input
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "處理中…" : "寄送登入連結"}
            </button>
          </form>
        ) : mode === "forgot" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit("forgot");
            }}
          >
            <label>
              電子信箱
              <input
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "處理中…" : "寄送重設連結"}
            </button>
          </form>
        ) : mode === "reset" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmToken("reset");
            }}
          >
            <label>
              新密碼
              <input
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "處理中…" : "重設密碼"}
            </button>
          </form>
        ) : mode === "verify" && token ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void confirmToken(tokenKind === "verify" ? "verify" : "redeem")}
          >
            {busy ? "處理中…" : "確認登入"}
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit("login");
            }}
          >
            <label>
              電子信箱
              <input
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              密碼
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "處理中…" : "登入"}
            </button>
          </form>
        )}
        <nav className="login-links" aria-label="其他登入方式">
          <button className="text-button" type="button" onClick={() => setMode("login")}>
            密碼登入
          </button>
          <button className="text-button" type="button" onClick={() => setMode("register")}>
            建立帳號
          </button>
          <button className="text-button" type="button" onClick={() => setMode("magic")}>
            登入連結
          </button>
          <button className="text-button" type="button" onClick={() => setMode("forgot")}>
            忘記密碼
          </button>
        </nav>
      </section>
    </main>
  );
}
