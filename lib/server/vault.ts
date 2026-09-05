import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "./security";
function key() {
  const value = process.env.CONSOLE_VAULT_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new ApiError(
      503,
      "vault_unconfigured",
      "請在後端設定 32-byte CONSOLE_VAULT_KEY。",
    );
  return Buffer.from(value, "hex");
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
