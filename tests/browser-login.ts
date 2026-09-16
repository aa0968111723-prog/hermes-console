import { expect, type Page } from "@playwright/test";

export async function signInEmail(
  page: Page,
  email = "owner@example.test",
  password = "correct-horse-battery",
) {
  const composer = page.getByRole("textbox", { name: "訊息", exact: true });
  if (await composer.isVisible().catch(() => false)) return;
  await expect(page.getByLabel("電子信箱")).toBeVisible();
  await page.getByLabel("電子信箱").fill(email);
  await page.getByLabel("密碼").fill(password);
  const enter = page.getByRole("button", { name: "進入工作區" });
  if (await enter.isVisible().catch(() => false)) await enter.click();
  const home = page.getByRole("heading", { name: "今天想做什麼？" });
  try {
    await home.waitFor({ timeout: 15_000 });
    return;
  } catch {
    const createToggle = page.getByRole("button", { name: "建立帳號" });
    if (await createToggle.isVisible().catch(() => false))
      await createToggle.click();
    await page.getByLabel("電子信箱").fill(email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "建立帳號" }).click();
    await expect(home).toBeVisible({ timeout: 15_000 });
  }
}
