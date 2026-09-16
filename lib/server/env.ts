export function validateProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const origin = process.env.CONSOLE_ORIGIN?.trim();
  if (!origin) {
    throw new Error("CONSOLE_ORIGIN is required in production.");
  }
  try {
    new URL(origin);
  } catch {
    throw new Error("CONSOLE_ORIGIN must be an absolute URL.");
  }
}
