"use client";

import ConsoleErrorBoundary from "@/components/ConsoleErrorBoundary";
import AuthGate from "@/components/AuthGate";
import HermesConsole from "@/components/HermesConsole";

export default function Page() {
  return (
    <ConsoleErrorBoundary>
      <AuthGate>
        <HermesConsole />
      </AuthGate>
    </ConsoleErrorBoundary>
  );
}
