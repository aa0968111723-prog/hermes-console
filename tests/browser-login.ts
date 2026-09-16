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

export async function openAppearanceSettings(page: Page) {
  const gear = page.getByRole("button", { name: "外觀設定", exact: true });
  if (await gear.isVisible().catch(() => false)) {
    await gear.click();
    return;
  }
  await page.getByRole("button", { name: "帳號設定", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "工作區設定" });
  await expect(settings).toBeVisible();
  await settings.getByRole("tab", { name: "外觀", exact: true }).click();
}

export async function openTasksPage(page: Page) {
  const chip = page.getByRole("button", { name: "任務與成果", exact: true });
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
    return;
  }
  await page.getByRole("button", { name: "開啟導覽", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "工作區導覽" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "任務", exact: true }).click();
}
