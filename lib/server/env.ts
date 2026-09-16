/** Startup checks. Missing optional OAuth/MCP stays unconfigured; never fake success. */
export function validateRuntimeEnv() {
  const origin = process.env.CONSOLE_ORIGIN?.trim() || "";
  if (!origin) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.CONSOLE_ALLOW_LOCAL_ACCESS !== "true"
    ) {
      throw new Error(
        "缺少 CONSOLE_ORIGIN。正式環境必須設定公開 HTTPS origin。",
      );
    }
    return;
  }
  try {
    new URL(origin);
  } catch {
    throw new Error("CONSOLE_ORIGIN 不是有效網址。");
  }
}
