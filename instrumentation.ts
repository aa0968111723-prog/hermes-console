export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startMonitor } = await import("./lib/server/monitor");
    startMonitor();
    const { startRuntimeMonitor } = await import(
      "./lib/server/hermes/runtime-monitor"
    );
    startRuntimeMonitor();
  }
}
