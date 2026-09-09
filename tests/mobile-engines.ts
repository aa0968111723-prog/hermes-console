import { chromium, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

// Browser emulation only. WebKit on CI is not a physical iPhone Safari run.
export async function verifyMobileEngines(base: string, output: string) {
  const results: unknown[] = [];
  for (const engine of ["chrome", "webkit"] as const) {
    const browser =
      engine === "chrome"
        ? await chromium.launch({ channel: "chrome" })
        : await webkit.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base);
      await expect(page.locator(".quick-action")).toHaveCount(4);
      for (const [width, height] of [
        [360, 800],
        [375, 812],
        [390, 844],
        [393, 852],
        [412, 915],
        [430, 932],
      ]) {
        await page.setViewportSize({ width, height });
        await expect
          .poll(() =>
            page
              .locator(".app-shell")
              .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
          )
          .toBe(height);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${engine} overflow ${width}`,
        );
        const dock = page.locator(".spatial-dock"),
          send = page.getByRole("button", { name: "送出訊息", exact: true });
        await expect(send).toBeInViewport({ ratio: 1 });
        const sendBox = await send.boundingBox(),
          dockBox = await dock.boundingBox();
        assert.ok(
          sendBox && dockBox && sendBox.y + sendBox.height <= dockBox.y,
        );
        for (const button of await dock.locator("button").all()) {
          const box = await button.boundingBox();
          assert.ok(box && box.width >= 44 && box.height >= 44);
        }
        await page.screenshot({
          path: join(output, `spatial-${engine}-${width}.png`),
        });
        results.push({
          engine,
          width,
          height,
          overflow: false,
          dockOverlapsComposer: false,
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".quick-action").first().tap();
      await expect(
        page.getByRole("textbox", { name: "訊息", exact: true }),
      ).toHaveValue("幫我找網宣靈感。");
      await page.getByRole("textbox", { name: "訊息", exact: true }).fill("");
      await page
        .getByRole("button", { name: "Hermes 操作", exact: true })
        .tap();
      const menu = page.getByRole("dialog", { name: "Hermes", exact: true });
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS("transform", "none");
      await page.screenshot({
        path: join(output, `spatial-${engine}-radial.png`),
      });
      // Explicit failure fixture: no fake memory or stale successful result.
      await page.route("**/api/memory?scope=all", (route) =>
        route.fulfill({
          status: 503,
          json: { error: { message: "[測試] 記憶服務暫時不可用" } },
        }),
      );
      await menu.getByRole("button", { name: "能力", exact: true }).tap();
      const space = page.getByRole("dialog", {
        name: "Hermes 空間",
        exact: true,
      });
      await expect(space.getByRole("alert")).toContainText(
        "記憶服務暫時不可用",
      );
      await expect(space.locator(".memory-orbs button")).toHaveCount(0);
      await page.unroute("**/api/memory?scope=all");
      await space.getByRole("button", { name: "重試", exact: true }).tap();
      await expect(space.getByRole("alert")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Hermes 操作", exact: true }),
      ).toBeFocused();
      for (const [name, shot] of [
        ["專案", "projects"],
        ["靈感", "inspiration"],
        ["任務", "tasks"],
        ["對話", "chat"],
      ]) {
        await page
          .locator(".spatial-dock")
          .getByRole("button", { name, exact: true })
          .tap();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: join(output, `spatial-${engine}-${shot}.png`),
        });
      }
      // Shrunk visual viewport approximates available keyboard space, not an OS keyboard.
      await page.setViewportSize({ width: 390, height: 420 });
      await expect(
        page.getByRole("button", { name: "送出訊息", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".app-shell")).toHaveAttribute(
        "data-spatial",
        "static",
      );
      assert.equal(
        await page
          .locator(".turtle img")
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  }
  await writeFile(
    join(output, "mobile-engines-report.json"),
    JSON.stringify(
      {
        deviceValidation:
          "Emulated Chrome and WebKit; no physical iPhone or Android device",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: mobile touch Chrome/WebKit, six sizes each, radial menu, scoped memory failure/retry, navigation, reduced motion. Not physical Safari.",
  );
}
