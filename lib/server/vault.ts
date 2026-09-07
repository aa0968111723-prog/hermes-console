import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "./security";
import { dataDir } from "./store";

const HEX64 = /^[a-f0-9]{64}$/i;

export type VaultKeySource = "env" | "file" | "generated";

let lastSource: VaultKeySource | "missing" = "missing";

export function vaultKeyPath() {
  return join(dataDir(), "vault.key");
}

export function vaultKeySource() {
  ensureVaultKey();
  return lastSource === "missing" ? "generated" : lastSource;
}

export function ensureVaultKey(): Buffer {
  const fromEnv = process.env.CONSOLE_VAULT_KEY;
  if (fromEnv && HEX64.test(fromEnv)) {
    lastSource = "env";
    return Buffer.from(fromEnv, "hex");
  }
  const path = vaultKeyPath();
  try {
    if (existsSync(path)) {
      const stored = readFileSync(path, "utf8").trim();
      if (HEX64.test(stored)) {
        lastSource = "file";
        return Buffer.from(stored, "hex");
      }
    }
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const generated = randomBytes(32).toString("hex");
    writeFileSync(path, generated, { encoding: "utf8", mode: 0o600 });
    lastSource = "generated";
    return Buffer.from(generated, "hex");
  } catch {
    throw new ApiError(
      503,
      "vault_unconfigured",
      "請在後端設定 32-byte CONSOLE_VAULT_KEY，或確保資料目錄可寫入以建立一次性金鑰。",
    );
  }
}

function key() {
  return ensureVaultKey();
}

export function seal(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(".");
}

export function unseal<T>(value: string): T {
  const [iv, tag, data] = value.split(".");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "hex")),
      cipher.final(),
    ]).toString("utf8"),
  ) as T;
}
