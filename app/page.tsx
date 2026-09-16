"use client";

import ConsoleErrorBoundary from "@/components/ConsoleErrorBoundary";
import AuthGate from "@/components/auth/AuthGate";

export default function Page() {
  return (
    <ConsoleErrorBoundary>
      <AuthGate />
    </ConsoleErrorBoundary>
  );
}
