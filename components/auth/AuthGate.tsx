"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "./AuthProvider";
import LoginScreen, { LoginMascot } from "./LoginScreen";

const HermesConsole = dynamic(() => import("@/components/HermesConsole"), {
  ssr: false,
  loading: () => (
    <main className="login-screen" role="status">
      <LoginMascot alt="" />
      <p>載入工作區</p>
    </main>
  ),
});

function GateStatus({
  children,
  action,
}: {
  children: string;
  action?: ReactNode;
}) {
  return (
    <main className="login-screen">
      <LoginMascot alt="" />
      <p role="status">{children}</p>
      {action}
    </main>
  );
}

export default function AuthGate() {
  const auth = useAuth();
  if (auth.loading) {
    return <GateStatus>確認身分</GateStatus>;
  }
  if (auth.unreachable && !auth.user) {
    return (
      <GateStatus
        action={
          <button type="button" className="primary" onClick={() => void auth.retry()}>
            再試一次
          </button>
        }
      >
        離線
      </GateStatus>
    );
  }
  if (auth.required && !auth.user) return <LoginScreen />;
  return <HermesConsole />;
}
