"use client";
import { useEffect, useState } from "react";
import Turtle from "./Turtle";

type Providers = {
  google: boolean;
  email: boolean;
  tamkang: { configured: boolean; message: string };
};

type Session = {
  user: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
    membership: string | null;
    identities: Array<{ provider: string }>;
  } | null;
  membership: string | null;
  providers: Providers;
};

const AUTH_ERRORS: Record<string, string> = {
  google_unconfigured: "Google 登入尚未完成設定。",
  tamkang_unconfigured: "淡江 SSO 尚未完成設定",
  oauth_failed: "外部登入未完成。",
  oauth_unconfigured: "此登入方式尚未完成設定。",
};

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("無法確認登入狀態。");
    setSession((await response.json()) as Session);
  }

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      document.documentElement.style.setProperty(
        "--app-height",
        (viewport?.height || window.innerHeight) + "px",
      );
      document.documentElement.style.setProperty(
        "--app-top",
        (viewport?.offsetTop || 0) + "px",
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error") || "";
    if (authError)
      setNotice(AUTH_ERRORS[authError] || "登入未完成。");
    if (authError)
      window.history.replaceState(null, "", window.location.pathname);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const login = hash.get("login") || "";
    const verify = hash.get("verify") || "";
    const reset = hash.get("reset") || "";
    if (login || verify || reset)
      window.history.replaceState(null, "", window.location.pathname);
    if (reset) {
      setResetToken(reset);
      setMode("reset");
    }
    void (async () => {
      try {
        if (login) {
          await fetch("/api/auth", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "redeem", token: login }),
          });
        } else if (verify) {
          await fetch("/api/auth/email", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "verify", token: verify }),
          });
        }
        await load();
      } catch {
        setNotice("無法確認登入狀態，請檢查網路。");
        setSession({
          user: null,
          membership: null,
          providers: {
            google: false,
            email: true,
            tamkang: { configured: false, message: "淡江 SSO 尚未完成設定" },
          },
        });
      }
    })();
  }, []);

  async function submit(action: "login" | "register" | "magic" | "forgot" | "reset") {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const body =
        action === "register"
          ? { action, email, password, name: name || "Hermes 使用者" }
          : action === "login"
            ? { action, email, password }
            : action === "reset"
              ? { action, token: resetToken, password }
              : { action: action === "forgot" ? "forgot" : "magic", email };
      const response = await fetch("/api/auth/email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "無法完成登入。");
      if (result.signedIn) await load();
      else setNotice(result.message || "已提交。");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!session)
    return (
      <main className="auth-gate" aria-busy="true">
        <p role="status">確認登入狀態</p>
      </main>
    );

  if (session.user && session.membership) return <>{children}</>;

  if (session.user && !session.membership)
    return (
      <main className="auth-gate">
        <Turtle
          offline={false}
          animation
          size={120}
          onClick={() => undefined}
          label="Hermes"
        />
        <h1>尚未加入工作區</h1>
        <p>登入成功，但這個帳號還沒有工作區權限。</p>
      </main>
    );

  const providers = session.providers;
  return (
    <main className="auth-gate">
      <Turtle
        offline={false}
        animation
        size={140}
        onClick={() => undefined}
        label="Hermes 龜龜"
      />
      <h1>Hermes</h1>
      <p className="auth-lead">先登入，再開始今天想做的事。</p>
      {notice && (
        <p role="status" className="auth-notice">
          {notice}
        </p>
      )}
      <a
        className="auth-provider"
        href={providers.google ? "/api/auth/google/start" : undefined}
        aria-disabled={!providers.google}
        onClick={(event) => {
          if (!providers.google) {
            event.preventDefault();
            setNotice("Google 登入尚未完成設定。");
          }
        }}
      >
        使用 Google 登入
      </a>
      <a
        className="auth-provider"
        href={providers.tamkang.configured ? "/api/auth/tamkang/start" : undefined}
        aria-disabled={!providers.tamkang.configured}
        onClick={(event) => {
          if (!providers.tamkang.configured) {
            event.preventDefault();
            setNotice(providers.tamkang.message);
          }
        }}
      >
        淡江 SSO
      </a>
      {!providers.tamkang.configured && (
        <p className="auth-hint">{providers.tamkang.message}</p>
      )}
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(mode === "register" ? "register" : mode === "reset" ? "reset" : "login");
        }}
      >
        {mode === "register" && (
          <label>
            稱呼
            <input
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        {mode !== "reset" && (
          <label>
            電子信箱
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        )}
        {mode !== "reset" ? (
          <label>
            密碼
            <input
              type="password"
              required
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              minLength={mode === "register" ? 12 : 1}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        ) : (
          <label>
            新密碼
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        <button className="primary" disabled={busy}>
          {mode === "register"
            ? "建立新帳號"
            : mode === "reset"
              ? "重設密碼"
              : "登入"}
        </button>
      </form>
      <div className="auth-links">
        <button
          type="button"
          className="text-button"
          onClick={() => setMode(mode === "register" ? "login" : "register")}
        >
          {mode === "register" ? "已有帳號" : "還沒有帳號"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy || !email}
          onClick={() => void submit("magic")}
        >
          寄送登入連結
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy || !email}
          onClick={() => void submit("forgot")}
        >
          忘記密碼
        </button>
      </div>
    </main>
  );
}
