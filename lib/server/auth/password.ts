import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import { verifyPassword as verifyScrypt } from "../security";

const MEMORY = Number(process.env.CONSOLE_ARGON2_MEMORY_KIB || 19456);
const ITERATIONS = Number(process.env.CONSOLE_ARGON2_ITERATIONS || 2);

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: Number.isFinite(ITERATIONS) && ITERATIONS >= 2 ? ITERATIONS : 2,
    memorySize: Number.isFinite(MEMORY) && MEMORY >= 4096 ? MEMORY : 19456,
    hashLength: 32,
    outputType: "encoded",
  });
}

export async function verifySecret(password: string, encoded: string) {
  if (encoded.startsWith("$argon2id$")) {
    try {
      return await argon2Verify({ password, hash: encoded });
    } catch {
      return false;
    }
  }
  if (encoded.startsWith("scrypt:")) return verifyScrypt(password, encoded);
  return false;
}
