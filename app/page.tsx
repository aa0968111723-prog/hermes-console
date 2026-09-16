"use client";

import ConsoleErrorBoundary from "@/components/ConsoleErrorBoundary";
import AuthProvider from "@/components/auth/AuthProvider";
import AuthGate from "@/components/auth/AuthGate";

export default function Page() {
  return (
    <ConsoleErrorBoundary>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ConsoleErrorBoundary>
  );
}
