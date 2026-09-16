"use client";

import HermesConsole from "@/components/HermesConsole";
import { useAuth } from "./AuthProvider";
import LoginScreen from "./LoginScreen";

export default function AuthGate() {
  const auth = useAuth();
  if (auth.loading) {
    return (
      <main className="login-screen" role="status">
        <img className="login-turtle" src="/mascot/turtle.png" alt="" />
        <p>確認身分</p>
      </main>
    );
  }
  if (auth.required && !auth.user) return <LoginScreen />;
  return <HermesConsole />;
}
