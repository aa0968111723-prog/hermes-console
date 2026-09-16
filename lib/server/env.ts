const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const origin = process.env.CONSOLE_ORIGIN?.trim();
  if (!origin) {
    throw new Error("CONSOLE_ORIGIN is required in production.");
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("CONSOLE_ORIGIN must be an absolute URL.");
  }
  if (parsed.protocol !== "https:" && !LOOPBACK.has(parsed.hostname)) {
    throw new Error("CONSOLE_ORIGIN must be https in production.");
  }
  if (process.env.CONSOLE_AUTH_MODE?.trim() === "workspace") {
    throw new Error(
      "CONSOLE_AUTH_MODE=workspace is not allowed in production. Use required.",
    );
  }
}
