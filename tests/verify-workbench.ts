import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { seedSession } from "./session-fixture";
const data = await mkdtemp(join(tmpdir(), "hermes-workbench-ui-"));
seedSession(data); // Invited identity fixture, not a mail-delivery simulation.
const database = new DatabaseSync(join(data, "console.sqlite"));
const token = randomBytes(32).toString("hex"), digest = createHash("sha256").update(token).digest("hex");
database.prepare("INSERT INTO records VALUES(?,?,?,?)").run("login_link", "access", digest,
  JSON.stringify({id: digest, memberId: "fixture-admin", used: false, expires: Date.now() + 900000}));
database.close();
const port = Number(process.env.WORKBENCH_TEST_PORT || 3418), base = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  windowsHide: true, stdio: "pipe", env: { ...process.env, NODE_ENV: "production", CONSOLE_ORIGIN: base,
    CONSOLE_DATA_DIR: data, CONSOLE_GATEWAY_SECRET: "", CONSOLE_REQUIRE_GATEWAY: "false",
    HERMES_API_URL: "", HERMES_API_KEY: "", HERMES_LEARNING_SCOPE_VERIFIED: "false", RESEND_API_KEY: "" },
});
let logs = "";
child.stdout?.on("data", d => { logs += d; }); child.stderr?.on("data", d => { logs += d; });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const output = resolve("output/playwright");
await mkdir(output, {recursive:true});
try {
  for (let i=0;i<100;i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  const context = await browser.newContext({ viewport:{width:390,height:844} });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e=>errors.push(e.message));
  page.on("request", request=>assert.ok(!request.url().includes(token), "login token must not enter request URL"));
  await page.goto(base);
  await expect(page.getByRole("heading", {name:"歡迎回到 Hermes"})).toBeVisible();
  assert.equal((await context.request.get(base+"/api/workspace")).status(),401);
  await page.screenshot({path:join(output,"invitation-mobile-390.png"),fullPage:true});
  await page.goto(base+"/#login="+token);
  await page.reload(); // Ensure the fragment is processed by the mounted entry component.
  await expect(page.getByRole("button",{name:"確認登入工作區",exact:true})).toBeVisible();
  assert.ok(!page.url().includes(token));
  assert.equal((await context.request.get(base+"/api/workspace")).status(),401, "opening a link cannot consume it");
  await page.getByRole("button",{name:"確認登入工作區",exact:true}).click();
  await expect(page.getByRole("heading",{name:"今天想做什麼？"})).toBeVisible();
  assert.equal((await context.request.post(base+"/api/auth",{headers:{Origin:base},data:{action:"redeem",token}})).status(),401);
  await page.getByRole("button",{name:"開啟導覽"}).click();
  await page.getByRole("button",{name:"專案",exact:true}).click();
  await page.getByRole("button",{name:"建立活動資料",exact:true}).click();
  await page.getByLabel("活動資料標題",{exact:true}).fill("驗證活動");
  for (const [label,value] of [["活動名稱","春日創作展"],["日期","2026-10-01"],["地點","活動展示廳"]])
    await page.getByRole("group",{name:label,exact:true}).getByLabel("內容",{exact:true}).fill(value);
  await page.getByRole("button",{name:"保存活動資料",exact:true}).click();
  await expect(page.getByText("活動已保存，新增或變更的資訊仍需核對。")).toBeVisible();
  await page.getByText("驗證活動 · v1",{exact:true}).click();
  for (const value of ["春日創作展","2026-10-01","活動展示廳"])
    await page.locator(".fact-row").filter({has:page.getByText(value,{exact:true})}).getByRole("button",{name:"確認此資訊"}).click();
  await page.getByRole("button",{name:"新增文案草稿",exact:true}).click();
  await page.getByLabel("文案標題",{exact:true}).fill("春日輪播草稿");
  await page.getByLabel("文案格式",{exact:true}).selectOption("carousel");
  await page.getByLabel("頁面文案",{exact:true}).fill("春日創作展 2026-10-01 活動展示廳");
  await page.getByRole("button",{name:"新增一頁／段"}).click();
  await page.getByLabel("頁面文案",{exact:true}).nth(1).fill("第二頁：一起看看春日創作。");
  await page.getByRole("button",{name:"保存文案版本",exact:true}).click();
  await expect(page.getByText("春日輪播草稿 · 1 版 · 未選定",{exact:true})).toBeVisible();
  await page.getByText("春日輪播草稿 · 1 版 · 未選定",{exact:true}).click();
  await page.locator(".workbench summary").filter({hasText:/^v1 ·/}).click();
  await page.getByRole("button",{name:"以 v1 繼續修改",exact:true}).click();
  await page.getByLabel("頁面文案",{exact:true}).nth(1).fill("第二頁：一起創作。");
  await page.getByRole("button",{name:"保存文案版本",exact:true}).click();
  const creative = await (await context.request.get(base+"/api/creative")).json();
  const doc = creative.copies[0];
  assert.equal(doc.revisions.length,2);
  assert.equal(doc.revisions[0].pages[1].body,"第二頁：一起看看春日創作。");
  assert.equal(doc.revisions[1].pages[1].body,"第二頁：一起創作。");
  assert.equal(doc.revisions[0].pages[0].body,doc.revisions[1].pages[0].body);
  const exported = await context.request.get(base+"/api/creative?download="+doc.id+"&revision=1");
  assert.equal(exported.status(),200);
  assert.match(await exported.text(),/一起看看春日創作/);
  await page.screenshot({path:join(output,"workbench-mobile-390.png"),fullPage:true});
  await page.getByRole("button",{name:"外觀設定"}).click();
  await page.getByRole("tab",{name:"記憶",exact:true}).click();
  const map = page.getByRole("region",{name:"記憶與學習地圖"});
  await map.getByLabel("學習標題",{exact:true}).fill("社團品牌風格");
  await map.getByLabel("學習分類",{exact:true}).selectOption("brand");
  await map.getByLabel("希望記住／學會的內容",{exact:true}).fill("親切、清楚；用活動價值開場，避免浮誇形容詞。");
  await map.getByRole("button",{name:"保存學習資料",exact:true}).click();
  await expect(map.getByText("我的學習地圖 · 1 個指定主題")).toBeVisible();
  await map.getByLabel("學習標題",{exact:true}).fill("輪播文案方法");
  await map.getByLabel("學習分類",{exact:true}).selectOption("skill");
  const learning = await (await context.request.get(base+"/api/learning")).json();
  await map.getByLabel("上層關聯",{exact:true}).selectOption(learning.nodes[0].id);
  await map.getByLabel("希望記住／學會的內容",{exact:true}).fill("第一頁提出重點，第二頁介紹活動，最後一頁放已核對的報名方式。");
  await map.getByRole("button",{name:"保存學習資料",exact:true}).click();
  await expect(map.getByText("我的學習地圖 · 2 個指定主題")).toBeVisible();
  await map.locator(".learning-tree > li > details > summary").click();
  await expect(map.getByRole("button",{name:"請 Hermes 學習",exact:true}).first()).toBeDisabled();
  await map.locator(".learning-root").scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path:join(output,"learning-mobile-390.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:join(output,"learning-desktop.png"),fullPage:true});
  await page.reload();
  await expect(page.getByRole("heading",{name:"今天想做什麼？"})).toBeVisible();
  assert.equal((await (await context.request.get(base+"/api/learning")).json()).nodes.length,2);
  await page.getByRole("button",{name:"外觀設定"}).click();
  await page.getByRole("tab",{name:"成員",exact:true}).click();
  await expect(page.getByLabel("邀請電子信箱",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"登出此裝置",exact:true}).click();
  await expect(page.getByRole("heading",{name:"歡迎回到 Hermes"})).toBeVisible();
  assert.equal((await context.request.get(base+"/api/creative")).status(),401);
  assert.ok(!logs.includes(token));
  assert.deepEqual(errors,[]);
  console.log("PASS: real production browser invitation redemption/replay/logout; activity confirmation; two-page revisions/export; persistent learning tree with honest unconfigured state. Email delivery, Hermes memory and Canva NOT live verified.");
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({path:join(output,"workbench-failure.png"),fullPage:true});
    console.error((await page.locator("body").innerText()).slice(0,12000));
  }
  throw error;
} finally { await browser.close(); child.kill(); }
