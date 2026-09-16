import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { signInConsole } from "./playwright-login";

const dataDir = await mkdtemp(join(tmpdir(), "hermes-entry-"));
const port = Number(process.env.ENTRY_TEST_PORT || 3220);
const base = "http://127.0.0.1:" + port;
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_ORIGIN: base,
      CONSOLE_ALLOW_LOCAL_ACCESS: "true",
      CONSOLE_GATEWAY_SECRET: "",
      CONSOLE_REQUIRE_GATEWAY: "false",
      CONSOLE_ADMIN_EMAILS: "",
      RESEND_API_KEY: "",
      CONSOLE_EMAIL_FROM: "",
      CONSOLE_DATA_DIR: dataDir,
      HERMES_API_URL: "",
      HERMES_API_KEY: "",
    },
  },
);
let logs = "";
child.stdout?.on("data", (chunk) => {
  logs += chunk;
});
child.stderr?.on("data", (chunk) => {
  logs += chunk;
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (child.exitCode !== null) throw new Error("Preview server exited\n" + logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  const workspace = await fetch(base + "/api/workspace");
  assert.equal(workspace.status, 401, "workspace GET requires a session");
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  const runtime = await fetch(base + "/api/runtime");
  assert.equal(runtime.status, 401, "runtime requires a session");
  const tasks = await fetch(base + "/api/tasks");
  assert.equal(tasks.status, 401);
  const cross = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ name: "blocked" }),
  });
  assert.equal(cross.status, 403);
  const created = await fetch(base + "/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ title: "免登入對話" }),
  });
  assert.equal(created.status, 401);
  const output = resolve("output/playwright");
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Hermes", exact: true })).toBeVisible();
  await expect(page.getByText("Google 登入尚未完成設定", { exact: true })).toBeVisible();
  await expect(page.getByText("淡江 SSO 尚未完成設定", { exact: true })).toBeVisible();
  await page.screenshot({
    path: join(output, "login-mobile.png"),
    fullPage: true,
  });
  await signInConsole(page);
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toBeVisible();
  await expect(page.locator(".connection-pill")).toContainText("未設定");
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill(
    "幫我找淡大禪學社茶會宣傳靈感",
  );
  await page.getByRole("button", { name: "送出訊息" }).click();
  await expect(page.locator("article.message.assistant")).toHaveCount(1);
  await expect(page.locator("article.message.assistant .visual-concept-deck")).toHaveCount(1);
  await expect(page.locator("article.message.assistant .markdown")).toHaveCount(0);
  await expect(page.getByText("Hermes Agent 尚未連線")).toHaveCount(1);
  await expect(page.getByText("本地索引", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Drive 快照/).first()).toBeVisible();
  await expect(page.locator(".visual-concept-deck")).toHaveAttribute(
    "data-overlay-date",
    "2026-09-30",
  );
  await expect(page.locator(".visual-concept-facts")).toContainText("2026-09-30");
  await expect(page.locator(".visual-concept-facts")).toContainText("留空");
  await expect(page.getByText("UNKNOWN：地點，畫面上留空。")).toBeVisible();
  await expect(page.getByText("尚未出圖 · 未發佈")).toBeVisible();
  await expect(page.getByText("概念 A")).toBeVisible();
  await expect(page.getByRole("button", { name: "選這個" })).toHaveCount(3);
  await page.getByRole("button", { name: "選這個" }).first().click();
  await expect(page.getByRole("button", { name: "已選定" })).toHaveCount(1);
  await expect(page.getByText("已選定概念 A")).toBeVisible();
  await expect(page.getByRole("heading", { name: "貼文文案" })).toBeVisible();
  await expect(page.locator(".visual-concept-caption")).toContainText("2026-09-30");
  await expect(page.locator(".visual-concept-caption")).toContainText("報名");
  await expect(page.getByText(/Canva 未授權/)).toBeVisible();
  await expect(page.getByText("尚未出圖 · 未發佈")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "執行紀錄", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".composer-task-status")).toHaveCount(0);
  const workflows = await page.request.get(base + "/api/workflows");
  const body = (await workflows.json()) as {
    workflows: Array<{ selected: number | null; design: unknown; state: string }>;
  };
  const chosen = body.workflows.find((item) => item.selected === 0);
  assert.ok(chosen);
  assert.equal(chosen.design, null);
  assert.notEqual(chosen.state, "draft_ready");
  await expect(page.getByText("1 / 1 個工具完成")).toHaveCount(0);
  const chat = await page.locator("body").innerText();
  assert.equal(chat.includes("已搜尋整個 Instagram"), false);
  await page.locator(".visual-concept-caption").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "chat-visual-direction-selected.png"),
  });
  await page.locator(".visual-concept-facts").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "chat-visual-concepts-mobile.png"),
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator(".visual-concept-facts")).toContainText("2026-09-30");
  await page.screenshot({
    path: join(output, "chat-visual-concepts-360.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "chat-local-knowledge-mobile.png"),
  });
  await page.getByRole("button", { name: "開啟新對話", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill(
    "幫我做一張淡江新生茶會宣傳",
  );
  await page.getByRole("button", { name: "送出訊息" }).click();
  await expect(
    page.locator("article.message.assistant .visual-concept-deck"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "執行紀錄", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".composer-task-status")).toHaveCount(0);
  await expect(page.getByText("尚未出圖 · 未發佈")).toBeVisible();
  await expect(page.getByText(/Canva 未授權/)).toBeVisible();
  await expect(page.getByText("已搜尋整個 Instagram")).toHaveCount(0);
  await page.screenshot({
    path: join(output, "chat-make-poster-mobile.png"),
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.getByRole("heading", { name: "連線", exact: true })).toBeVisible();
  await expect(page.locator(".runtime-human-summary")).toContainText("Hermes");
  await expect(page.locator(".runtime-human-summary")).toContainText("MCP");
  await expect(page.locator(".runtime-human-summary")).toContainText("未驗證");
  await expect(page.locator(".runtime-human-summary")).toContainText("未設定");
  await expect(page.locator(".runtime-advanced > summary")).toBeVisible();
  await page.screenshot({
    path: join(output, "agent-status-dots-mobile.png"),
  });
  await page.getByRole("button", { name: "對話", exact: true }).click();
  const authed = await page.request.post(base + "/api/conversations", {
    headers: { Origin: base },
    data: { title: "登入後對話" },
  });
  assert.equal(authed.status(), 201);
  const text = await page.locator("body").innerText();
  for (const word of [
    "受邀電子信箱",
    "寄送登入連結",
    "歡迎回到 Hermes",
    "正在驗證工作區存取",
  ])
    assert.ok(!text.includes(word), "invitation UI visible: " + word);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "專案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "素材與靈感" })).toBeVisible();
  const poster = await readFile("public/mascot/turtle.png");
  await page.locator(".secondary-page input[type=\"file\"]").setInputFiles({
    name: "龜龜參考.png",
    mimeType: "image/png",
    buffer: poster,
  });
  await expect(
    page.getByRole("button", { name: "預覽素材：龜龜參考.png" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.locator(".workbench-disclosure > summary").click();
  const projectPage = page.locator(".secondary-page");
  const scrolled = await projectPage.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return {
      reached: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
      overflowY: getComputedStyle(el).overflowY,
    };
  });
  assert.equal(["auto", "scroll", "overlay"].includes(scrolled.overflowY), true);
  assert.equal(scrolled.reached, true);
  const beforePreview = await projectPage.evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "預覽素材：龜龜參考.png" }).click();
  const preview = page.getByRole("dialog", { name: "素材預覽" });
  await expect(preview.locator("img")).toBeVisible();
  await expect(preview).toHaveCSS("opacity", "1");
  await expect(preview).toHaveCSS("transform", "none");
  assert.ok(
    await preview
      .locator("img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
  );
  await page.screenshot({
    path: join(output, "project-preview-mobile.png"),
  });
  await page.getByRole("button", { name: "關閉面板" }).click();
  await expect(preview).toBeHidden();
  await expect
    .poll(() =>
      projectPage.evaluate(
        (el, previous) => Math.abs(el.scrollTop - previous) < 48,
        beforePreview,
      ),
    )
    .toBe(true);
  const afterClose = await projectPage.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return {
      reached: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
      overflowY: getComputedStyle(el).overflowY,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      bodyOverflow: getComputedStyle(document.body).overflow,
    };
  });
  assert.equal(["auto", "scroll", "overlay"].includes(afterClose.overflowY), true);
  assert.equal(afterClose.reached, true);
  assert.equal(["hidden", "clip"].includes(afterClose.htmlOverflow), true);
  assert.equal(["hidden", "clip"].includes(afterClose.bodyOverflow), true);
  await expect(page.getByRole("button", { name: "專案", exact: true })).toBeVisible();
  await page.screenshot({
    path: join(output, "project-mobile-390.png"),
  });
  await page.setViewportSize({ width: 412, height: 915 });
  await projectPage.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole("heading", { name: "素材與靈感" })).toBeVisible();
  await page.screenshot({
    path: join(output, "project-mobile-412.png"),
  });
  await page.setViewportSize({ width: 430, height: 932 });
  await projectPage.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.screenshot({
    path: join(output, "project-mobile-430.png"),
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await projectPage.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole("heading", { name: "素材與靈感" })).toBeVisible();
  await expect(page.getByRole("button", { name: "預覽素材：龜龜參考.png" })).toBeVisible();
  await page.screenshot({
    path: join(output, "project-tablet-768.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "對話", exact: true }).click();
  await expect(page.getByText("素材已保存", { exact: true })).toHaveCount(0);
  const box = page.getByRole("textbox", { name: "訊息", exact: true });
  await box.click();
  await page.evaluate(() => {
    if (!window.visualViewport) throw new Error("visualViewport unavailable");
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 420,
    });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-composer-keyboard",
    "open",
  );
  await expect(page.locator(".mobile-bottom-dock")).toBeHidden();
  await expect(page.locator(".jump-button")).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator(".app-shell")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(420);
  const keyboardSend = await page
    .getByRole("button", { name: "送出訊息", exact: true })
    .boundingBox();
  assert.ok(
    keyboardSend && keyboardSend.y + keyboardSend.height <= 420,
    "software keyboard must not cover the send button",
  );
  await expect(box).toBeVisible();
  await page.screenshot({
    path: join(output, "composer-keyboard-entry-390x420.png"),
    clip: { x: 0, y: 0, width: 390, height: 420 },
  });
  await page.evaluate(() => {
    if (!window.visualViewport) return;
    Reflect.deleteProperty(window.visualViewport, "height");
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-composer-keyboard",
    "open",
  );
  await expect(page.locator(".mobile-bottom-dock")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".app-shell")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(844);
  await box.fill("這張哪裡可以改？");
  await page.getByRole("button", { name: "送出訊息" }).click();
  await expect(page.getByText("請先上傳海報")).toBeVisible();
  await expect(page.getByText(/假裝已看圖/)).toBeVisible();
  await page.screenshot({
    path: join(output, "chat-poster-critique-honest.png"),
  });
  await page.getByRole("button", { name: "專案", exact: true }).click();
  await page.getByRole("button", { name: "加入對話" }).click();
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toBeVisible();
  await expect(page.locator(".context-card")).toContainText("龜龜參考.png");
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill(
    "這張哪裡可以改？",
  );
  await page.getByRole("button", { name: "送出訊息" }).click();
  const attached = page.locator("article.message.assistant").last();
  await expect(attached).toContainText("圖片已保存");
  await expect(attached).toContainText("不能讀取像素");
  await expect(attached).toContainText("假裝已看圖");
  await attached.scrollIntoViewIfNeeded();
  await expect(page.getByText(/視覺層級：/)).toHaveCount(0);
  await expect(page.locator(".notice-bar.warning")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "執行紀錄", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: join(output, "chat-poster-attached-honest.png"),
  });
  await page.context().setOffline(true);
  await expect(page.getByText("離線 · 顯示上次資料")).toBeVisible();
  await expect(page.locator(".turtle").first()).toHaveAttribute(
    "data-state",
    "offline",
  );
  await expect(attached).toContainText("圖片已保存");
  await page.screenshot({
    path: join(output, "chat-offline-reconnect.png"),
  });
  await page.context().setOffline(false);
  await expect(page.getByText("離線 · 顯示上次資料")).toHaveCount(0);
  await expect(attached).toContainText("圖片已保存");
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByRole("tab", { name: "帳號", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登入方式" })).toBeVisible();
  await expect(page.getByText("電子信箱 ✓", { exact: true })).toBeVisible();
  await expect(page.getByText("工作區角色：擁有者")).toBeVisible();
  const linkButtons = page.getByRole("link", { name: "連結", exact: true });
  await expect(linkButtons).toHaveCount(2);
  await expect(linkButtons.nth(0)).toHaveAttribute(
    "href",
    "/api/auth/google/start",
  );
  await expect(linkButtons.nth(1)).toHaveAttribute(
    "href",
    "/api/auth/tamkang/start",
  );
  await expect(
    page.getByText("不會只因為電子信箱相同就自動合併帳號。"),
  ).toBeVisible();
  await page.screenshot({
    path: join(output, "account-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: login gate then workspace, local club index without fake MCP or task chrome, project upload/preview/close, 768, simulated keyboard, poster honesty with and without file, offline reconnect, account identities. Not live Zeabur or physical Android.",
  );
} finally {
  await browser?.close();
  child.kill();
}
