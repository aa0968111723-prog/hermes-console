import { expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
export async function verifyMobileSpatial(
  page: Page,
  base: string,
  output: string,
  audit: (name: string) => Promise<void>,
) {
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByRole("button", { name: "重設外觀", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "開啟 Hermes 空間", exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-spatial",
    "reduced",
  );
  assert.ok((await page.locator(".compact-orbit .orbit-node").count()) <= 4);
  await page.screenshot({ path: join(output, "spatial-home-390.png") });
  await page.getByRole("button", { name: "Hermes 操作", exact: true }).click();
  const radial = page.getByRole("dialog", { name: "Hermes", exact: true });
  await expect(radial).toBeVisible();
  await expect(radial).toHaveCSS("transform", "none");
  await expect(radial.locator(".radial-actions button")).toHaveCount(5);
  for (const button of await radial.locator("button").all()) {
    const box = await button.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44);
  }
  await audit("spatial-radial");
  await page.screenshot({ path: join(output, "spatial-radial-390.png") });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Hermes 操作", exact: true }),
  ).toBeFocused();
  // The primary mobile action sheet must honor the real appearance preference,
  // including on a short viewport where larger labels need flexible rows.
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page
    .getByRole("combobox", { name: /文字大小/ })
    .selectOption("20");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 360, height: 560 });
  await page.getByRole("button", { name: "Hermes 操作", exact: true }).click();
  await expect(radial).toBeVisible();
  await expect(radial).toHaveCSS("transform", "none");
  const radialBounds = await radial.boundingBox();
  assert.ok(
    radialBounds &&
      radialBounds.y >= 0 &&
      radialBounds.y + radialBounds.height <= 560,
    "large-text radial sheet must remain inside the short viewport",
  );
  await page.screenshot({
    path: join(output, "spatial-radial-large-text-360x560.png"),
  });
  await expect(radial.locator(".radial-actions button").first()).toHaveCSS(
    "font-size",
    "20px",
  );
  for (const button of await radial.locator(".radial-actions button").all()) {
    const fits = await button.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth &&
        element.scrollHeight <= element.clientHeight,
    );
    assert.ok(fits, "large-text radial action must not clip");
  }
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "large-text radial sheet must not overflow horizontally",
  );
  await audit("spatial-radial-large-text");
  await page.keyboard.press("Escape");
  // On a zoom-equivalent narrow and short viewport, the action grid scrolls
  // inside the dialog. Simulate a notched phone's bottom inset because desktop
  // Playwright does not expose env(safe-area-inset-bottom); the sheet must keep
  // that reserved area clear and retain the only visible close action.
  await page.setViewportSize({ width: 320, height: 360 });
  const safeAreaBottom = 34;
  await page.evaluate((inset) => {
    document.documentElement.style.setProperty(
      "--safe-area-bottom",
      `${inset}px`,
    );
  }, safeAreaBottom);
  await page.getByRole("button", { name: "Hermes 操作", exact: true }).click();
  await expect(radial).toBeVisible();
  await expect(radial).toHaveCSS("transform", "none");
  const safeAreaSheetBounds = await radial.boundingBox();
  assert.ok(
    safeAreaSheetBounds &&
      safeAreaSheetBounds.y >= 0 &&
      safeAreaSheetBounds.y + safeAreaSheetBounds.height <=
        360 - 90 - safeAreaBottom,
    "large-text radial sheet must remain above the bottom safe area",
  );
  assert.equal(
    await radial.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
    true,
    "large-text radial sheet must scroll in an extra-short viewport",
  );
  await radial.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => radial.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const shortSheetBounds = await radial.boundingBox();
  const closeBounds = await radial
    .getByRole("button", { name: "關閉 Hermes 操作" })
    .boundingBox();
  assert.ok(
    shortSheetBounds &&
      closeBounds &&
      closeBounds.y >= shortSheetBounds.y &&
      closeBounds.y + closeBounds.height <=
        shortSheetBounds.y + shortSheetBounds.height,
    "large-text radial close action must remain visible while scrolling",
  );
  await audit("spatial-radial-large-text-scrolled");
  await page.screenshot({
    path: join(output, "spatial-radial-large-text-scrolled-320x360.png"),
  });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("--safe-area-bottom");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByRole("button", { name: "重設外觀", exact: true }).click();
  await page.keyboard.press("Escape");
  // Real file chooser -> actual Console upload, including when opened outside chat.
  await page
    .locator(".mobile-bottom-dock")
    .getByRole("button", { name: "專案", exact: true })
    .click();
  await page.getByRole("button", { name: "Hermes 操作", exact: true }).click();
  const choosing = page.waitForEvent("filechooser");
  await radial.getByRole("button", { name: "圖片", exact: true }).click();
  await (
    await choosing
  ).setFiles({
    name: "spatial-reference.png",
    mimeType: "image/png",
    buffer: await readFile("public/mascot/turtle.png"),
  });
  await expect(page.locator(".context-card")).toContainText("已保存");
  await page
    .getByRole("button", { name: "預覽附件：spatial-reference.png" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "素材預覽" }).locator("img"),
  ).toBeVisible();
  await page.screenshot({
    path: join(output, "spatial-upload-preview-390.png"),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "移除附件" }).click();
  const workspace = await (
    await page.request.get(base + "/api/workspace")
  ).json();
  const foreign = workspace.projects[0]?.id;
  for (const [scope, title] of [
    ["workspace", "空間測試偏好"],
    ...(foreign ? [[foreign, "其他專案的隱藏資料"]] : []),
  ]) {
    const response = await page.request.post(base + "/api/memory", {
      headers: { Origin: base },
      data: {
        scope,
        title,
        kind: "preference",
        content: "只使用已確認的活動資訊。",
        tags: [],
      },
    });
    assert.ok(response.ok(), "real memory fixture save");
  }
  await page
    .getByRole("button", { name: "開啟 Hermes 空間", exact: true })
    .click();
  const space = page.getByRole("dialog", { name: "Hermes 空間", exact: true });
  await expect(space.getByText("空間測試偏好", { exact: true })).toBeVisible();
  await expect(
    space.getByText("其他專案的隱藏資料", { exact: true }),
  ).toHaveCount(0);
  assert.ok((await space.locator(".orbit-node").count()) <= 5);
  await space
    .getByRole("button", { name: "空間測試偏好", exact: true })
    .click();
  await expect(space.locator(".memory-node-detail")).toContainText(
    "只使用已確認",
  );
  await audit("spatial-memory");
  await page.screenshot({ path: join(output, "spatial-memory-390.png") });
  await space.getByRole("button", { name: "管理記憶", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "工作區設定" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "記憶", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-spatial",
    "static",
  );
  await page.reload(); // Unsent attachments/drafts do not leak into the next suite.
}
