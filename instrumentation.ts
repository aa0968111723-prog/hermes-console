export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMonitor } = await import("./lib/server/monitor");
    startMonitor();
  }
}
