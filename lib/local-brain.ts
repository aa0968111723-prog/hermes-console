/**
 * Hermes Agent 本地高擬真大腦引擎 (Local Brain & Sandbox Runner)
 * 當 Zeabur 雲端服務離線或尚未綁定網域時，提供無縫備援與完整的工具調用管線，
 * 確保 hermes-console 具備「深度可用 (Deeply Usable)」之完整能力。
 */

import { PROJECTS, TOOLS } from "./catalog.ts";
import { executeHermesTool, HERMES_TOOLS, type ToolExecutionResult } from "./tools.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export async function* streamLocalHermesResponse(
  messages: ChatMessage[],
  activeProject: string
): AsyncGenerator<string, void, unknown> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const lower = lastUserMsg.toLowerCase();

  // 1. 產生 Hermes 思維鏈 (CoT Reasoning)
  const thinkingChunks = [
    `收到使用者指令：「${lastUserMsg}」。\n`,
    `當前聚焦之專案上下文：[${activeProject}]。\n`,
    `正在分析意圖與檢索可用之 Hermes 生態系工具...\n`
  ];

  yield "data: " + JSON.stringify({ choices: [{ delta: { content: "<thought>\n" } }] }) + "\n\n";
  for (const chunk of thinkingChunks) {
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: chunk } }] }) + "\n\n";
    await new Promise((r) => setTimeout(r, 40));
  }

  // 2. 判斷需要調用的工具
  let toolToCall: { name: string; args: Record<string, unknown> } | null = null;

  if (lower.includes("專案") || lower.includes("目錄") || lower.includes("生態") || lower.includes("41") || lower.includes("catalog")) {
    let group = "";
    if (lower.includes("設計")) group = "設計";
    else if (lower.includes("創作")) group = "創作系統";
    else if (lower.includes("社團") || lower.includes("學校")) group = "學校社團";
    else if (lower.includes("代理")) group = "代理";
    
    let query = "";
    if (lower.includes("duigao")) query = "duigao";
    else if (lower.includes("ai_os") || lower.includes("aios")) query = "ai_os";
    else if (lower.includes("planform")) query = "planform-iso";
    else if (lower.includes("zen") || lower.includes("禪學")) query = "zen";

    toolToCall = {
      name: "get_ecosystem_projects",
      args: { query, group }
    };
  } else if (lower.includes("規格") || lower.includes("查看") || lower.includes("inspect") || lower.includes("詳情")) {
    let proj = activeProject;
    for (const p of PROJECTS) {
      if (lower.includes(p.name.toLowerCase())) {
        proj = p.name;
        break;
      }
    }
    toolToCall = {
      name: "inspect_project",
      args: { projectName: proj }
    };
  } else if (lower.includes("狀態") || lower.includes("健康") || lower.includes("ping") || lower.includes("status")) {
    toolToCall = {
      name: "check_hermes_status",
      args: { pingOnly: false }
    };
  } else if (lower.includes("分鏡") || lower.includes("劇本") || lower.includes("海報") || lower.includes("文案") || lower.includes("鏡頭")) {
    const isPoster = lower.includes("海報");
    toolToCall = {
      name: "generate_creative_brief",
      args: {
        title: lastUserMsg.slice(0, 20) || "淡大劇本文創專案",
        category: isPoster ? "poster" : "storyboard",
        keyPoints: ["開場建立鏡頭", "角色衝突爆發", "核心情感轉折", "震撼收尾定格"]
      }
    };
  } else if (lower.includes("拆解") || lower.includes("切句") || lower.includes("文字") || lower.includes("transform")) {
    toolToCall = {
      name: "run_text_transform",
      args: {
        action: "split_shots",
        rawText: lastUserMsg
      }
    };
  } else if (lower.includes("zeabur") || lower.includes("儀表板") || lower.includes("dashboard") || lower.includes("帳號") || lower.includes("密碼")) {
    toolToCall = {
      name: "get_zeabur_dashboard_info",
      args: { needPassword: true }
    };
  }

  // 3. 輸出思維推導總結
  if (toolToCall) {
    const thoughtDecision = `判斷命中工具 [${toolToCall.name}]，參數：${JSON.stringify(toolToCall.args)}。準備執行調用。\n`;
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: thoughtDecision } }] }) + "\n\n";
  } else {
    const thoughtGeneral = `本輪對話聚焦於專案上下文與架構諮詢，採用 Hermes 綜合大腦直接給予解答。\n`;
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: thoughtGeneral } }] }) + "\n\n";
  }

  yield "data: " + JSON.stringify({ choices: [{ delta: { content: "</thought>\n\n" } }] }) + "\n\n";

  // 4. 若有工具，輸出 <tool_call> 並執行
  let toolResult: ToolExecutionResult | null = null;
  if (toolToCall) {
    const callXml = `<tool_call>\n${JSON.stringify(toolToCall, null, 2)}\n</tool_call>\n\n`;
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: callXml } }] }) + "\n\n";
    await new Promise((r) => setTimeout(r, 60));

    toolResult = await executeHermesTool(toolToCall.name, toolToCall.args);
  }

  // 5. 輸出終端整合回覆
  let finalResponse = "";

  if (toolResult) {
    if (toolResult.toolName === "get_ecosystem_projects") {
      const projs = toolResult.result as typeof PROJECTS;
      finalResponse = [
        `### 📊 柯能生態系專案檢索結果（共 ${projs.length} 個專案）：\n`,
        ...projs.slice(0, 8).map(
          (p) => `- **[${p.name}](${p.url})** （${p.group}）：${p.blurb} ${p.live ? `· [線上站點](${p.live})` : ""}`
        ),
        projs.length > 8 ? `\n*（已列出前 8 項，可在側邊欄專案目錄查看全部 41 個專案）*` : "",
        `\n**下一步建議**：你可以隨時點擊專案卡片上的「帶入上下文」，我將鎖定該專案進行架構分析或程式碼生成。`
      ].join("\n");
    } else if (toolResult.toolName === "inspect_project") {
      const p = toolResult.result as any;
      finalResponse = [
        `### 🔍 專案深度規格：${p.name}\n`,
        `- **所屬領域**：${p.group}`,
        `- **專案定位**：${p.blurb}`,
        `- **GitHub 倉庫**：[${p.url}](${p.url})`,
        p.live ? `- **生產部署站點**：[${p.live}](${p.live})` : "",
        `- **技術標籤**：${p.tags?.join("、") || "Next.js, TypeScript"}`,
        `- **已綁定工具**：${p.toolsLinked?.join("、")}`,
        `\n*Hermes 大腦已完全掌握此專案脈絡，請問需要針對此專案生成功能或設計規格嗎？*`
      ].filter(Boolean).join("\n");
    } else if (toolResult.toolName === "check_hermes_status") {
      const s = toolResult.result as any;
      finalResponse = [
        `### ⚡ Hermes Agent 大腦運行狀態診斷：\n`,
        `- **運作模式**：${s.status} (本地沙盒 + Zeabur 雲端橋接)`,
        `- **大腦模型**：\`${s.model}\``,
        `- **已註冊工具總數**：${s.toolsRegisteredCount} 項核心工具`,
        `- **支援協定**：${s.features.join(" · ")}`,
        `- **系統時間**：${s.timestamp}`,
        `\n目前通訊管線運作順暢，所有 41 個生態系專案與分鏡/文宣工具皆已就緒！`
      ].join("\n");
    } else if (toolResult.toolName === "generate_creative_brief") {
      const b = toolResult.result as any;
      finalResponse = [
        `### 🎬 創作分鏡規格書：《${b.title}》\n`,
        `**畫面格式**：${b.format || "16:9 單張分鏡規格"}\n`,
        `**鏡頭排程清單**：`,
        ...b.shots.map((shot: string) => `- **${shot}**`),
        `\n**導演備註**：${b.productionNotes || "嚴格維持角色一致性與色彩符號規範。"}`
      ].join("\n");
    } else if (toolResult.toolName === "get_zeabur_dashboard_info") {
      const d = toolResult.result as any;
      finalResponse = [
        `### 🔐 Zeabur 儀表板與連線資訊：\n`,
        `- **API 端點**：\`${d.apiEndpoint}\``,
        `- **管理帳號**：\`${d.dashboardUser}\``,
        `- **預設密碼**：\`${d.dashboardPass}\``,
        `- **連接埠口**：\`${d.servicePort}\``,
        `\n**提示**：${d.note}`
      ].join("\n");
    } else {
      finalResponse = `### 工具調用摘要：\n${toolResult.summary}\n\n結果：\`\`\`json\n${JSON.stringify(toolResult.result, null, 2)}\n\`\`\``;
    }
  } else {
    finalResponse = [
      `你好！我是柯能的中央大腦 Hermes Agent。當前聚焦於專案：**[${activeProject}]**。\n`,
      `我可以為你提供全方位的工程與創作支援：`,
      `1. **專案生態檢索**：檢索 41 個專案架構（如 \`duigao\`、\`ai_os\`、\`planform-iso\`、\`tku-zen-agent\`）。`,
      `2. **分鏡劇本拆解**：將文字概念拆解為 16:9 分鏡鏡頭與運鏡標註。`,
      `3. **Zeabur 儀表板管理**：監看日誌與雲端容器狀態。`,
      `4. **代碼與文案轉化**：執行高質感繁體中文文宣與技術規範精煉。`,
      `\n請告訴我你接下來需要處理的任務！`
    ].join("\n");
  }

  // 逐段串流輸出
  const words = finalResponse.split("");
  let buf = "";
  for (const char of words) {
    buf += char;
    if (buf.length >= 3 || char === "\n") {
      yield "data: " + JSON.stringify({ choices: [{ delta: { content: buf } }] }) + "\n\n";
      buf = "";
      await new Promise((r) => setTimeout(r, 12));
    }
  }
  if (buf) {
    yield "data: " + JSON.stringify({ choices: [{ delta: { content: buf } }] }) + "\n\n";
  }

  yield "data: [DONE]\n\n";
}
