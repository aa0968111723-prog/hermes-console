"use client";

import ConsoleErrorBoundary from "@/components/ConsoleErrorBoundary";
import HermesConsole from "@/components/HermesConsole";

export default function Page() {
  return (
    <ConsoleErrorBoundary>
      <HermesConsole />
    </ConsoleErrorBoundary>
  );
}
