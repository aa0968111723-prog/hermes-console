import { randomBytes, scryptSync } from "node:crypto";
import process from "node:process";
if (!process.stdin.isTTY) {
  console.error("請在互動終端執行，密碼不接受命令列參數或日誌輸入。");
  process.exit(1);
}
process.stdout.write("輸入全新的工作區密碼（至少 14 字元，不回顯）：");
process.stdin.setRawMode(true);
process.stdin.resume();
let password = "";
process.stdin.on("data", (chunk) => {
  const key = chunk.toString();
  if (key === "\u0003") process.exit(1);
  if (key === "\r" || key === "\n") {
    process.stdin.setRawMode(false);
    if (password.length < 14) {
      console.error("\n密碼至少需 14 字元。");
      process.exit(1);
    }
    const salt = randomBytes(16).toString("hex");
    console.log(
      "\nCONSOLE_PASSWORD_HASH=scrypt:" +
        salt +
        ":" +
        scryptSync(password, salt, 64).toString("hex"),
    );
    process.exit(0);
  }
  if (key === "\u007f" || key === "\b") password = password.slice(0, -1);
  else password += key;
});
