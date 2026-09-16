import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const ARGON_OPTS = { t: 2, m: 19_456, p: 1, dkLen: 32 };

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const digest = argon2id(utf8ToBytes(password), salt, ARGON_OPTS);
  return "argon2id:" + bytesToHex(salt) + ":" + bytesToHex(digest);
}

export function verifyPasswordHash(password: string, encoded: string) {
  const [scheme, salt, value] = encoded.split(":");
  if (scheme === "argon2id" && salt && value) {
    const digest = argon2id(utf8ToBytes(password), hexToBytes(salt), ARGON_OPTS);
    const expected = hexToBytes(value);
    return (
      digest.length === expected.length && timingSafeEqual(digest, expected)
    );
  }
  if (
    scheme === "scrypt" &&
    /^[a-f0-9]{32}$/.test(salt || "") &&
    /^[a-f0-9]{128}$/.test(value || "")
  ) {
    return timingSafeEqual(
      scryptSync(password, salt, 64),
      Buffer.from(value, "hex"),
    );
  }
  return false;
}

export function passwordUsable(password: string) {
  return password.length >= 12 && password.length <= 200;
}
