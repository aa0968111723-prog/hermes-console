import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const TEST = !!process.env.NODE_TEST_CONTEXT;
const PARAMS = TEST
  ? { t: 1, m: 4096, p: 1, dkLen: 32 }
  : { t: 2, m: 19456, p: 1, dkLen: 32 };

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = argon2id(password, salt, {
    ...PARAMS,
    maxmem: PARAMS.m * 1024,
  });
  return `argon2id:m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}:${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

export function verifyPassword(password: string, encoded: string) {
  if (encoded.startsWith("argon2id:")) {
    const [, paramPart, saltHex, hashHex] = encoded.split(":");
    const parsed = /m=(\d+),t=(\d+),p=(\d+)/.exec(paramPart || "");
    if (
      !parsed ||
      !/^[a-f0-9]{32}$/.test(saltHex || "") ||
      !/^[a-f0-9]{64}$/.test(hashHex || "")
    )
      return false;
    const m = Number(parsed[1]);
    const hash = argon2id(password, hexToBytes(saltHex), {
      t: Number(parsed[2]),
      m,
      p: Number(parsed[3]),
      dkLen: hashHex.length / 2,
      maxmem: m * 1024,
    });
    return timingSafeEqual(Buffer.from(hash), Buffer.from(hashHex, "hex"));
  }
  const [scheme, salt, value] = encoded.split(":");
  if (
    scheme !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(value || "")
  )
    return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(value, "hex"),
  );
}

export function passwordPolicy(password: string) {
  if (password.length < 10) return "密碼至少 10 個字元。";
  if (password.length > 200) return "密碼過長。";
  return null;
}
