import { expect, type Page } from "@playwright/test";

const EMAIL = "owner@test.local";
const PASSWORD = "test-password-12";

export async function signInConsole(page: Page) {
  const workspace = page.getByRole("heading", { name: "今天想做什麼？" });
  if (await workspace.isVisible().catch(() => false)) return;
  await expect(
    page.getByRole("heading", { name: "Hermes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "還沒有帳號", exact: true }).click();
  await page.getByLabel("稱呼").fill("測試使用者");
  await page.getByLabel("電子信箱").fill(EMAIL);
  await page.getByLabel("密碼").fill(PASSWORD);
  await page.getByRole("button", { name: "建立新帳號", exact: true }).click();
  const conflict = page.getByText("此電子信箱已有帳號");
  await Promise.race([
    workspace.waitFor({ state: "visible", timeout: 20_000 }),
    conflict.waitFor({ state: "visible", timeout: 20_000 }),
  ]).catch(() => undefined);
  if (await workspace.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "已有帳號", exact: true }).click();
  await page.getByLabel("電子信箱").fill(EMAIL);
  await page.getByLabel("密碼").fill(PASSWORD);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(workspace).toBeVisible();
}
