"use client";

import ConsoleErrorBoundary from "@/components/ConsoleErrorBoundary";
import OwnerGate from "@/components/OwnerGate";

export default function Page() {
  return (
    <ConsoleErrorBoundary>
      <OwnerGate />
    </ConsoleErrorBoundary>
  );
}
