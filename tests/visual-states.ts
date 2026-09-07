import { expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Real uploads/settings first; explicitly labelled UI response fixtures second.
 * The fixtures never configure credentials, publish, or contact external providers. */
export async function verifyVisualStates(
  page: Page,
  base: string,
  output: string,
  audit: (name: string) => Promise<void>,
) {
  await page.reload();
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill("");
  await page.getByRole("button", { name: "加入內容", exact: true }).click();
  await expect(page.getByRole("group", { name: "加入內容選項" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "加入內容", exact: true }),
  ).toBeFocused();
  const image = await readFile("public/mascot/turtle.png");
  await page.locator('input[type="file"]').setInputFiles({
    name: "龜龜參考.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.locator(".context-card")).toContainText("已保存");
  await page.getByRole("button", { name: "預覽附件：龜龜參考.png" }).click();
  const preview = page.getByRole("dialog", { name: "素材預覽" });
  await expect(preview.locator("img")).toBeVisible();
  assert.ok(
    await preview
      .locator("img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
  );
  await page.screenshot({ path: join(output, "image-preview.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "context-mobile.png") });
  await audit("image-context-mobile");
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByRole("tab", { name: "連線", exact: true }).click();
  await expect(page.getByRole("group", { name: "選擇連線" })).toBeVisible();
  await expect(page.locator(".connection-editor")).toBeHidden();
  await page.screenshot({
    path: join(output, "settings-connections-mobile.png"),
  });
  await audit("connections-mobile");
  const picker = page.getByRole("group", { name: "選擇連線" });
  for (const name of [
    "GALLEY",
    "淡江",
    "Lumen",
    "Atlas",
    "FrameLab",
    "訊核",
    "Zeabur",
    "Hermes",
  ]) {
    await picker
      .getByRole("button", { name: new RegExp("^" + name + "：") })
      .click();
    await expect(
      page.locator(".connection-editor section:visible"),
    ).toHaveCount(1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: join(output, "settings-connections-desktop.png"),
  });
  await audit("connection-editor");
  await picker.getByRole("button", { name: /^Canva：/ }).click();
  await expect(page.getByRole("region", { name: "Canva 授權" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /前往 Canva 授權/ }),
  ).toBeDisabled();
  await page.screenshot({ path: join(output, "canva-unconfigured.png") });
  await page.keyboard.press("Escape");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "專案", exact: true })
    .click();
  await expect(page.locator(".project-thumbnail img").first()).toBeVisible();
  await page.screenshot({ path: join(output, "projects-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "projects-mobile.png") });
  await audit("projects-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Browser UI fixtures only: visible labels distinguish these from live evidence.
  const workspace = await (
    await page.request.get(base + "/api/workspace")
  ).json();
  const now = new Date().toISOString();
  const task = {
    id: "ui-fixture-task",
    conversationId: "ui-fixture-conversation",
    requestKey: "ui-fixture",
    payloadHash: "ui-fixture",
    state: "running",
    transport: "runs",
    remoteId: "ui-fixture-remote",
    input: "[介面測試資料] 研究春日活動參考",
    output: "",
    attachments: [],
    createdAt: now,
    updatedAt: now,
    endedAt: null as string | null,
    error: null as string | null,
    observationError: null,
    usage: {
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
      providerCost: null,
      toolCost: null,
    },
    stopSupported: true,
    events: [
      {
        id: "event-1",
        taskId: "ui-fixture-task",
        toolCallId: "call-1",
        toolName: "galley_research",
        status: "running",
        startedAt: now,
        endedAt: null as string | null,
        summary: "[介面測試事件] 研究來源",
        result: null,
        sources: ["https://example.com/reference"],
        error: null,
        usage: null,
      },
    ],
  };
  await page.route("**/api/tasks", (route) =>
    route.fulfill({ json: { tasks: [task] } }),
  );
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: {
        ...workspace,
        conversations: [
          {
            id: task.conversationId,
            projectId: "personal",
            title: "[介面測試] 工具與成果",
            createdAt: now,
            updatedAt: now,
            hermesSessionId: null,
            messages: [
              {
                id: "ui-user",
                role: "user",
                content: task.input,
                createdAt: now,
                taskId: task.id,
              },
              ...(task.output
                ? [
                    {
                      id: "ui-answer",
                      role: "assistant",
                      content: task.output,
                      createdAt: now,
                      taskId: task.id,
                      provenance: "hermes",
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/api/workflows", (route) =>
    route.fulfill({
      json: {
        workflows: [
          {
            id: "ui-fixture-artifact-B",
            projectId: "personal",
            brief: "[介面測試資料] 成果預覽與接續修改；不是外部製作紀錄",
            directions: [],
            selected: 1,
            state: "draft_ready",
            createdAt: now,
            updatedAt: now,
            canvaJobId: null,
            error: null,
            design: {
              id: "ui-fixture-design",
              title: "[介面測試] 成果 B",
              thumbnail: {
                url: "https://www.canva.com/ui-fixture-preview.png",
              },
              urls: {
                edit_url: "https://www.canva.com/design/ui-fixture/edit",
              },
            },
          },
        ],
      },
    }),
  );
  await page.route("https://www.canva.com/ui-fixture-preview.png", (route) =>
    route.fulfill({ contentType: "image/png", body: image }),
  );
  await page.evaluate(
    "localStorage.setItem('hermes.active.v2','ui-fixture-conversation'); localStorage.removeItem('hermes.ui.v2')",
  );
  await page.reload();
  await expect(page.locator(".agent-activity .activity-active")).toContainText(
    "研究",
  );
  await expect(page.locator(".turtle")).toHaveAttribute(
    "data-state",
    "researching",
  );
  await page.screenshot({ path: join(output, "tool-running-fixture.png") });
  await audit("tool-running-fixture");
  task.state = "completed";
  task.endedAt = now;
  task.events[0].status = "completed";
  task.events[0].endedAt = now;
  task.output =
    "[介面測試回覆] 已接收一個工具結果。\n\n| 方向 | 用途 |\n| --- | --- |\n| 春日共創 | 活動宣傳 |";
  await page.reload();
  await expect(page.locator(".visual-message")).toContainText("1 / 1");
  await page.locator(".source-cards > summary").click();
  await expect(page.locator(".source-card")).toHaveAttribute(
    "href",
    "https://example.com/reference",
  );
  await expect(page.locator(".activity-active")).toHaveCount(0);
  await page.screenshot({ path: join(output, "chat-fixture.png") });
  await audit("chat-fixture");
  await page.getByRole("button", { name: "任務與成果" }).click();
  await expect(
    page.getByRole("region", { name: "設計成果預覽" }),
  ).toBeVisible();
  await expect(page.locator(".artifact-stage img")).toBeVisible();
  await page.screenshot({ path: join(output, "artifact-fixture.png") });
  await audit("artifact-fixture");
  await page.getByRole("button", { name: "在對話修改這個作品" }).click();
  await expect(
    page.getByRole("textbox", { name: "訊息", exact: true }),
  ).toContainText("ui-fixture-artifact-B");
  task.state = "failed";
  task.error = "[介面測試錯誤] 來源服務暫時不可用";
  await page.reload();
  await expect(page.locator(".turtle")).toHaveAttribute("data-state", "error");
  await page.screenshot({ path: join(output, "error-fixture.png") });
  await page.context().setOffline(true);
  await expect(page.locator(".turtle")).toHaveAttribute(
    "aria-label",
    /連線待確認/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "offline-mobile.png") });
  await page.context().setOffline(false);
  await page.unrouteAll({ behavior: "wait" });
}
