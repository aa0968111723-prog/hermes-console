import { expect, type Page, type Request } from "@playwright/test";
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
  await page.locator('#composer input[type="file"]').setInputFiles({
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
    observationError: null as string | null,
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
  // Keep the same sizes before/after composer changes for CI artifact review.
  const accidentalSubmissions: string[] = [];
  const observeSubmission = (request: Request) => {
    if (request.method() === "POST" && /\/api\/(tasks|conversations)(\?|$)/.test(request.url()))
      accidentalSubmissions.push(request.url());
  };
  page.on("request", observeSubmission);
  for (const [width, height] of [[360, 740], [390, 420], [844, 390], [768, 1024], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    const composer = page.getByRole("textbox", { name: "訊息", exact: true });
    const draft = "[介面測試草稿] 等候工具結果";
    await composer.fill(draft);
    const status = page.getByRole("button", { name: "查看目前任務：執行中，研究 · GALLEY", exact: true });
    await expect(status).toBeInViewport({ ratio: 1 });
    await expect(composer).toBeInViewport({ ratio: 1 });
    const box = await status.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
    await page.screenshot({ path: join(output, `task-access-${width}x${height}.png`) });
    await status.focus();
    await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog", { name: "任務詳情" });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("ui-fixture-task");
    const technical = detail.locator(".task-technical");
    const technicalSummary = technical.locator("summary");
    if ((await technical.getAttribute("open")) !== null)
      await technicalSummary.click();
    await expect(technical).not.toHaveAttribute("open", "");
    await expect(technicalSummary).toContainText("技術資訊");
    await expect(technical.locator("code").first()).toBeHidden();
    if (width === 390 && height === 420) {
      await page.screenshot({
        path: join(output, "task-technical-collapsed-390x420.png"),
      });
      await technicalSummary.click();
      await expect(technical.locator("code").first()).toBeVisible();
      await expect(technical.locator("code").first()).toHaveText(task.id);
      await technicalSummary.click();
    }
    const taskUsage = detail.getByRole("region", { name: "任務用量" });
    await expect(taskUsage).toContainText("等待 Hermes 回傳");
    await expect(taskUsage).not.toContainText("未知");
    await expect(taskUsage.locator(".usage-metric")).toHaveCount(0);
    const eventDetails = detail.locator(".event").first();
    const eventSummary = eventDetails.locator("summary");
    if ((await eventDetails.getAttribute("open")) !== null)
      await eventSummary.click();
    await expect(eventDetails).not.toHaveAttribute("open", "");
    await expect(eventSummary).toContainText("研究 · GALLEY");
    await expect(eventSummary).toContainText("執行中");
    await expect(eventSummary).toContainText("[介面測試事件] 研究來源");
    await expect(eventSummary).not.toContainText("galley_research");
    if ((width === 390 && height === 420) || width === 1440) {
      await eventSummary.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, `task-events-${width}x${height}.png`) });
    }
    await eventSummary.click();
    await expect(eventDetails).toHaveAttribute("open", "");
    await expect(detail.locator(".event-meta code").first()).toBeVisible();
    await expect(detail.locator(".event-meta code").first()).toHaveText("galley_research");
    await page.keyboard.press("Escape");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(draft);
  }
  page.off("request", observeSubmission);
  assert.deepEqual(accidentalSubmissions, [], "viewing task details must never submit the draft");
  // Long conversations and unbroken tool names must not displace the shortcut.
  const originalInput = task.input;
  task.input = Array.from({ length: 24 }, (_, i) => `[介面測試段落 ${i + 1}] 保留長對話，查看目前任務`).join("\n\n");
  task.events[0].toolName = "unknown_" + "long_tool_name_".repeat(12);
  await page.setViewportSize({ width: 360, height: 420 });
  await page.reload();
  await expect(page.locator(".conversation")).toContainText("[介面測試段落 24]");
  await expect(page.locator(".composer-task-tool")).toHaveText("工具");
  await expect(page.locator(".composer-task-status")).not.toContainText(task.events[0].toolName);
  await expect(page.locator(".composer-task-tool")).toHaveAttribute("title", `技術名稱：${task.events[0].toolName}`);
  const conversationScroll = page.locator(".conversation-scroll");
  assert.ok(await conversationScroll.evaluate(el => el.scrollHeight > el.clientHeight));
  await conversationScroll.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await expect(page.locator(".composer-task-status")).toBeInViewport({ ratio: 1 });
  await conversationScroll.evaluate(el => el.scrollTo(0, 0));
  await expect(page.locator(".composer-task-status")).toBeInViewport({ ratio: 1 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, "task-access-long-conversation.png") });
  await page.locator(".composer-task-status").click();
  const longTaskDetail = page.getByRole("dialog", { name: "任務詳情" });
  await expect
    .poll(() =>
      longTaskDetail
        .locator(".panel-content")
        .evaluate((element) => element.scrollTop),
    )
    .toBe(0);
  await expect(longTaskDetail.locator(".panel-header")).toBeInViewport();
  const requestPreview = longTaskDetail.locator(".task-request-preview");
  await expect(requestPreview).toBeVisible();
  assert.ok((await requestPreview.innerText()).length <= 141);
  const previewLayout = await requestPreview.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
  assert.ok(
    previewLayout.height <= previewLayout.lineHeight * 4 + 1,
    "long request preview must stay within four visible lines",
  );
  const fullRequest = longTaskDetail.locator(".task-request-full");
  const fullRequestSummary = fullRequest.locator("summary");
  await expect(fullRequestSummary).toContainText("查看完整需求");
  await expect(fullRequest.locator("p")).toBeHidden();
  const fullRequestBox = await fullRequestSummary.boundingBox();
  assert.ok(fullRequestBox && fullRequestBox.height >= 44);
  await page.screenshot({ path: join(output, "task-request-long-collapsed-360x420.png") });
  await fullRequestSummary.click();
  await expect(fullRequest.locator("p")).toBeVisible();
  await expect(fullRequest.locator("p")).toContainText("[介面測試段落 24]");
  await page.keyboard.press("Escape");
  task.input = originalInput;
  task.events[0].toolName = "galley_research";
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The essential task shortcut must survive turning the decorative pet off.
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByRole("tab", { name: "外觀", exact: true }).click();
  await page.getByLabel("顯示龜龜", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".turtle")).toHaveCount(0);
  await expect(page.locator(".composer-task-status")).toBeVisible();
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByLabel("顯示龜龜", { exact: true }).check();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 360, height: 420 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  task.events[0].status = "completed";
  for (const [state, label] of [["queued", "排隊"], ["waiting_user", "等待確認"], ["stopping", "停止確認中"], ["uncertain", "結果待確認"]]) {
    task.state = state;
    await page.reload();
    const status = page.getByRole("button", { name: `查看目前任務：${label}`, exact: true });
    await expect(status).toBeInViewport({ ratio: 1 });
    await expect(status.locator(".composer-task-tool")).toHaveCount(0);
    assert.equal(await status.evaluate(el => getComputedStyle(el).animationName), "none");
    await page.screenshot({ path: join(output, `task-access-${state}-reduced.png`) });
  }
  task.state = "running";
  task.events[0].status = "running";
  task.observationError = "[介面測試] 狀態查詢失敗";
  await page.reload();
  await expect(page.locator(".composer-task-status")).toContainText("連線異常 · 狀態待確認");
  await expect(page.locator(".composer-task-tool")).toHaveCount(0);
  await page.screenshot({ path: join(output, "task-access-stale.png") });
  await audit("task-access-stale-mobile");
  task.observationError = null;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill("");
  task.state = "completed";
  task.endedAt = now;
  task.events[0].status = "completed";
  task.events[0].endedAt = now;
  task.output =
    "[介面測試回覆] 已接收一個工具結果。\n\n| 方向 | 用途 |\n| --- | --- |\n| 春日共創 | 活動宣傳 |";
  await page.reload();
  await expect(page.locator(".composer-task-status")).toContainText("完成");
  await expect(page.locator(".visual-message")).toContainText("1 / 1");
  await page.setViewportSize({ width: 390, height: 420 });
  await page.locator(".composer-task-status").click();
  let taskUsage = page.getByRole("dialog", { name: "任務詳情" })
    .getByRole("region", { name: "任務用量" });
  await expect(taskUsage).toContainText("未回傳用量資料");
  await expect(taskUsage).not.toContainText("未知");
  await taskUsage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "task-usage-missing-390x420.png") });
  await page.keyboard.press("Escape");

  Object.assign(task.usage, {
    model: "[介面測試模型]",
    inputTokens: 1000,
    outputTokens: null,
    totalTokens: 1234,
    durationMs: 1650,
    providerCost: null,
    toolCost: 0,
  });
  await page.reload();
  await page.locator(".composer-task-status").click();
  taskUsage = page.getByRole("dialog", { name: "任務詳情" })
    .getByRole("region", { name: "任務用量" });
  await expect(taskUsage).toContainText("已回傳 5 項");
  await expect(taskUsage.locator(".usage-highlights")).toContainText("1,234");
  await expect(taskUsage).not.toContainText("輸出 tokens");
  const usageDetails = taskUsage.getByText("查看明細", { exact: true });
  const usageDetailsBox = await usageDetails.boundingBox();
  assert.ok(usageDetailsBox && usageDetailsBox.height >= 44);
  await usageDetails.click();
  await expect(taskUsage).toContainText("輸入 tokens");
  await expect(taskUsage).toContainText("外部工具費用");
  await taskUsage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "task-usage-partial-390x420.png") });
  await page.keyboard.press("Escape");
  Object.assign(task.usage, {
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    durationMs: null,
    providerCost: null,
    toolCost: null,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"放大設計預覽",exact:true}).click();
  const artifactPreview=page.getByRole("dialog",{name:"作品全螢幕預覽",exact:true});
  await expect(artifactPreview).toBeVisible();
  await expect.poll(()=>artifactPreview.locator("img").evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
  await audit("artifact-fullscreen-mobile-fixture");
  await page.screenshot({path:join(output,"spatial-artifact-390-fixture.png")});
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name:"放大設計預覽",exact:true})).toBeFocused();
  await page.getByRole("button", { name: "在對話修改這個作品" }).click();
  await expect(
    page.getByRole("textbox", { name: "訊息", exact: true }),
  ).toContainText("ui-fixture-artifact-B");
  task.state = "failed";
  task.error = "[介面測試錯誤] 來源服務暫時不可用";
  await page.reload();
  await expect(page.locator(".turtle")).toHaveAttribute("data-state", "error");
  await expect(page.locator(".composer-task-status")).toContainText("失敗");
  await page.locator(".composer-task-status").click();
  await expect(page.getByRole("dialog", { name: "任務詳情" })).toContainText(task.error);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(output, "error-fixture.png") });
  await page.context().setOffline(true);
  await expect(page.locator(".turtle")).toHaveAttribute(
    "aria-label",
    /連線待確認/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".composer-task-status")).toContainText("離線 · 狀態待確認");
  await page.screenshot({ path: join(output, "offline-mobile.png") });
  await page.context().setOffline(false);
  await page.unrouteAll({ behavior: "wait" });
}
