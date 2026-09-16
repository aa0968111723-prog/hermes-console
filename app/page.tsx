"use client";

import dynamic from "next/dynamic";
import ConsoleErrorBoundary from "@/components/ConsoleErrorBoundary";
import AuthGate from "@/components/AuthGate";

const HermesConsole = dynamic(() => import("@/components/HermesConsole"), {
  loading: () => (
    <main className="workspace-loading" role="status">
      載入工作區…
    </main>
  ),
});

export default function Page() {
  return (
    <ConsoleErrorBoundary>
      <AuthGate>
        <HermesConsole />
      </AuthGate>
    </ConsoleErrorBoundary>
  );
}
