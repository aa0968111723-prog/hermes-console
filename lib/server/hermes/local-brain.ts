import { HERMES_TOOLS, executeHermesTool, type ToolExecutionResult } from "./tools";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export async function* streamLocalHermesResponse(
  messages: ChatMessage[],
  activeProject = "tku-zen-agent"
): AsyncGenerator<string, void, unknown> {
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const lower = lastUserMsg.toLowerCase();

  // 1. 輸出思維推導標籤
  yield "data: " + JSON.stringify({ choices: [{ delta: { content: "<thought>\n" } }] }) + "\n\n";

  const thoughts = [
    `接收到使用者需求：「${lastUserMsg.slice(0, 30)}...」\n`,
    `當前焦點專案上下文鎖定為：[${activeProject}]\n`,
    `正在檢索內部知識庫與可用工具能力...\n`
  ];

  for (const t of thoughts) {
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: t } }] }) + "\n\n";
    await new Promise((r) => setTimeout(r, 20));
  }

  // 2. 判斷需要調用的工具
  let toolToCall: { name: string; args: Record<string, unknown> } | null = null;

  if (
    lower.includes("專案") ||
    lower.includes("目錄") ||
    lower.includes("生態") ||
    lower.includes("catalog")
  ) {
    toolToCall = {
      name: "get_ecosystem_projects",
      args: { query: "", group: "" }
    };
  } else if (
    lower.includes("規格") ||
    lower.includes("查看") ||
    lower.includes("inspect")
  ) {
    toolToCall = {
      name: "inspect_project",
      args: { projectName: activeProject }
    };
  } else if (
    lower.includes("狀態") ||
    lower.includes("健康") ||
    lower.includes("ping") ||
    lower.includes("status")
  ) {
    toolToCall = {
      name: "check_hermes_status",
      args: { pingOnly: false }
    };
  } else if (
    lower.includes("分鏡") ||
    lower.includes("劇本") ||
    lower.includes("海報") ||
    lower.includes("文案")
  ) {
    const isPoster = lower.includes("海報");
    toolToCall = {
      name: "generate_creative_brief",
      args: {
        title: lastUserMsg.slice(0, 20) || "淡江專案文創",
        category: isPoster ? "poster" : "storyboard",
        keyPoints: [
          "開場建立鏡頭：淡水夕照與克難坡校園全景",
          "痛點共鳴：大一新生面對課業與人際的迷惘",
          "轉折體驗：禪學社靜心茶會的身心安頓",
          "呼籲行動：茶會報名連結與暖心標語"
        ]
      }
    };
  } else if (
    lower.includes("拆解") ||
    lower.includes("切句") ||
    lower.includes("transform")
  ) {
    toolToCall = {
      name: "run_text_transform",
      args: {
        action: "split_shots",
        rawText: lastUserMsg
      }
    };
  }

  // 3. 輸出思維推導總結
  if (toolToCall) {
    const thoughtDecision = `判斷命中工具 [${toolToCall.name}]，準備調用。\n`;
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: thoughtDecision } }] }) + "\n\n";
  } else {
    const thoughtGeneral = `專案諮詢模式，採用 Hermes 繁體中文智庫直接解答。\n`;
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: thoughtGeneral } }] }) + "\n\n";
  }

  yield "data: " + JSON.stringify({ choices: [{ delta: { content: "</thought>\n\n" } }] }) + "\n\n";

  // 4. 若有工具，輸出結果
  let toolResult: ToolExecutionResult | null = null;
  if (toolToCall) {
    const callXml = `<tool_call>\n${JSON.stringify(toolToCall, null, 2)}\n</tool_call>\n\n`;
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: callXml } }] }) + "\n\n";
    toolResult = await executeHermesTool(toolToCall.name, toolToCall.args);
  }

  // 5. 輸出終端整合回覆
  let finalResponse = "";

  if (toolResult) {
    if (toolResult.toolName === "generate_creative_brief") {
      const b = toolResult.result as { title: string; shots?: string[]; headline?: string };
      finalResponse = [
        `### 🎬 創作分鏡規格書：《${b.title}》\n`,
        `**鏡頭排程清單**：`,
        ...(b.shots || []).map((shot: string) => `- **${shot}**`),
        `\n**執行備註**：嚴格維持淡江校園地標與淡水意象一致性。`
      ].join("\n");
    } else {
      finalResponse = `### 工具調用成果：\n${toolResult.summary}\n\n\`\`\`json\n${JSON.stringify(toolResult.result, null, 2)}\n\`\`\``;
    }
  } else {
    finalResponse = [
      `你好！我是中央大腦 Hermes Agent。當前聚焦於專案：**[${activeProject}]**。\n`,
      `為你提供全方位的工程與創作支援：`,
      `1. **專案生態檢索**：支援各項開源專案與淡江在地模組。`,
      `2. **分鏡劇本拆解**：將文字概念拆解為 16:9 分鏡鏡頭與運鏡標註。`,
      `3. **社群文宣排版**：提供 Canva 藍圖與繁體中文文案精煉。`,
      `\n請告訴我你接下來需要執行的任務！`
    ].join("\n");
  }

  // 逐段串流輸出
  const words = finalResponse.split("");
  let buf = "";
  for (const char of words) {
    buf += char;
    if (buf.length >= 4 || char === "\n") {
      yield "data: " + JSON.stringify({ choices: [{ delta: { content: buf } }] }) + "\n\n";
      buf = "";
      await new Promise((r) => setTimeout(r, 8));
    }
  }
  if (buf) {
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: buf } }] }) + "\n\n";
  }

  yield "data: [DONE]\n\n";
}
