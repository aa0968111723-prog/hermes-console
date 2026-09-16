"use client";

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

export default function AuthGate() {
  const auth = useAuth();
  if (auth.loading) {
    return (
      <main className="login-screen" role="status">
        <LoginMascot alt="" />
        <p>確認身分</p>
      </main>
    );
  }
  if (auth.required && !auth.user) return <LoginScreen />;
  return <HermesConsole />;
}
