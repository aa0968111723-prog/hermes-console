import { accessSync, constants, existsSync } from "node:fs";
import { validateRuntimeEnv } from "./env";
import { dataDir, probeStore, sqliteFile } from "./store";
import { vaultKeyPath } from "./vault";
import { credentialPresence } from "./credentials";

export type RehearsalService = {
  id: string;
  configured: boolean;
};

export type RehearsalReport = {
  ok: boolean;
  production: boolean;
  originConfigured: boolean;
  store: {
    backend: "sqlite" | "postgres";
    ready: boolean;
    dataDir: string;
    sqlitePresent: boolean;
    vaultKeyPresent: boolean;
    writable: boolean;
  };
  services: RehearsalService[];
  errors: string[];
  warnings: string[];
};

function service(id: string, names: string[]): RehearsalService {
  try {
    return {
      id,
      configured: names.every((name) => credentialPresence(name).configured),
    };
  } catch {
    return { id, configured: false };
  }
}

function writable(dir: string) {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Honest pre-deploy check. Never prints secret values or claims live success. */
export function rehearsalReport(): RehearsalReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    validateRuntimeEnv();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "環境檢查失敗。");
  }
  const probe = probeStore();
  const dir = dataDir();
  const services = [
    service("hermes", ["HERMES_API_URL", "HERMES_API_KEY"]),
    service("google", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]),
    service("tamkang", ["TAMKANG_SSO_ISSUER", "TAMKANG_SSO_CLIENT_ID"]),
    service("mail", ["RESEND_API_KEY", "CONSOLE_EMAIL_FROM"]),
    service("gateway", ["CONSOLE_GATEWAY_SECRET"]),
  ];
  for (const item of services) {
    if (!item.configured)
      warnings.push(item.id + " 尚未設定；介面必須顯示未完成，不得假裝成功。");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.NODE_TEST_CONTEXT || process.env.CONSOLE_TEST_SESSION)
  )
    errors.push("測試用 session 不得用於正式環境。");
  const report: RehearsalReport = {
    ok: errors.length === 0 && probe.ok,
    production: process.env.NODE_ENV === "production",
    originConfigured: Boolean(process.env.CONSOLE_ORIGIN?.trim()),
    store: {
      backend: probe.backend,
      ready: probe.ok,
      dataDir: dir,
      sqlitePresent: existsSync(sqliteFile()),
      vaultKeyPresent: existsSync(vaultKeyPath()),
      writable: writable(dir),
    },
    services,
    errors,
    warnings,
  };
  return report;
}
