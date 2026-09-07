import type { Health, Task } from "../../contracts";
import { ApiError, WORKSPACE_OWNER } from "../security";
import { list } from "../store";
import {
  readJSON,
  resolveAgent,
  target,
  upstream,
} from "../hermes";
import { credentialPresence, runtimeEnv } from "../credentials";
import { listMemories, memoryShareStatus } from "../memory";
import { canvaConfigured, canvaStatus } from "../canva";
import { tamkangConfigured } from "../tamkang";
import { seedRegistry } from "../mcp-registry";
import {
  listZeaburProjects,
  listZeaburVariables,
  testZeabur,
  zeaburPublicStatus,
} from "../zeabur";
import type {
  CapabilityRecord,
  CapabilityStatus,
  CertificationEvidence,
  CertificationReport,
  EvidenceKind,
  IntegrationCertification,
  IntegrationId,
} from "./types";
import {
  allIntegrationIds,
  emptyIntegration,
  findCapability,
} from "./registry";
import { evidenceKindForUrl, nowIso, overallFromCapabilities } from "./evidence";
import { emptyReport, loadReport, saveReport } from "./store";

function mark(
  cap: CapabilityRecord,
  status: CapabilityStatus,
  message: string,
  evidence: Omit<CertificationEvidence, "at"> | null,
  latencyMs: number | null = evidence?.latencyMs ?? null,
) {
  cap.status = status;
  cap.message = message;
  cap.lastCheckedAt = nowIso();
  cap.latencyMs = latencyMs;
  cap.evidence = evidence
    ? { ...evidence, at: nowIso(), latencyMs: evidence.latencyMs ?? latencyMs }
    : null;
  if (status === "verified") cap.lastVerifiedAt = cap.lastCheckedAt;
}

function kindFor(url?: string | null): EvidenceKind {
  return evidenceKindForUrl(url);
}

function finish(integration: IntegrationCertification) {
  const required = integration.capabilities
    .filter((item) => item.required)
    .map((item) => item.status);
  integration.overall = overallFromCapabilities(
    integration.capabilities.map((item) => item.status),
    required,
  );
  integration.lastCheckedAt = nowIso();
  return integration;
}

async function timed<T>(fn: () => Promise<T>) {
  const started = Date.now();
  try {
    const value = await fn();
    return { value, latencyMs: Date.now() - started, error: null as ApiError | null };
  } catch (error) {
    return {
      value: null as T | null,
      latencyMs: Date.now() - started,
      error: error instanceof ApiError ? error : new ApiError(502, "probe_failed", "探測失敗。"),
    };
  }
}

function taskEvidenceKind(owner: string): EvidenceKind {
  try {
    return kindFor(resolveAgent({ role: "general" }).url);
  } catch {
    return "UNVERIFIED";
  }
}

function hermesTasks(owner: string) {
  return list<Task>("task", owner);
}

async function certifyHermes(owner: string): Promise<IntegrationCertification> {
  const report = emptyIntegration("hermes");
  const api = findCapability(report, "hermes.api");
  const auth = findCapability(report, "hermes.auth");
  const models = findCapability(report, "hermes.models");
  const chat = findCapability(report, "hermes.chat");
  const streaming = findCapability(report, "hermes.streaming");
  const runs = findCapability(report, "hermes.runs");
  const runStatus = findCapability(report, "hermes.run_status");
  const cancel = findCapability(report, "hermes.cancel");
  const tools = findCapability(report, "hermes.tools");
  const skills = findCapability(report, "hermes.skills");
  const mcp = findCapability(report, "hermes.mcp");
  const memory = findCapability(report, "hermes.memory");
  const image = findCapability(report, "hermes.image");
  const usage = findCapability(report, "hermes.usage");

  const urlSet = credentialPresence("HERMES_API_URL").configured;
  const keySet = credentialPresence("HERMES_API_KEY").configured;
  if (!urlSet || !keySet) {
    for (const cap of report.capabilities) {
      mark(cap, "unknown", "尚未在連線設定或環境變數提供 Hermes 網域與金鑰。", null);
    }
    return finish(report);
  }

  let base = "";
  try {
    const resolved = resolveAgent({ role: "general" });
    base = target(resolved.url, resolved.key);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Hermes 設定無效。";
    mark(api, "failed", message, {
      kind: "UNVERIFIED",
      summary: message,
      latencyMs: null,
      httpStatus: null,
      errorCode: error instanceof ApiError ? error.code : "invalid_target",
    });
    mark(auth, "unknown", "目標網址無效，尚未進行認證。", null);
    return finish(report);
  }

  const evidenceKind = kindFor(base);
  mark(api, "configured", "已設定 Hermes 網址。", {
    kind: evidenceKind,
    summary: "憑證已設定，尚未證明可連線。",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  mark(auth, "configured", "已設定 Hermes 金鑰。", {
    kind: evidenceKind,
    summary: "金鑰已設定，尚未證明有效。",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });

  const modelsProbe = await timed(() => upstream("/v1/models"));
  if (modelsProbe.error) {
    const failed = modelsProbe.error.code === "connect_timeout" || modelsProbe.error.code === "network_error";
    mark(
      api,
      failed ? "failed" : "reachable",
      modelsProbe.error.message,
      {
        kind: evidenceKind,
        summary: modelsProbe.error.message,
        latencyMs: modelsProbe.latencyMs,
        httpStatus: null,
        errorCode: modelsProbe.error.code,
      },
      modelsProbe.latencyMs,
    );
    mark(
      auth,
      modelsProbe.error.code === "upstream_401" || modelsProbe.error.code === "upstream_403"
        ? "failed"
        : "unknown",
      modelsProbe.error.message,
      {
        kind: evidenceKind,
        summary: modelsProbe.error.message,
        latencyMs: modelsProbe.latencyMs,
        httpStatus: null,
        errorCode: modelsProbe.error.code,
      },
      modelsProbe.latencyMs,
    );
    mark(models, "failed", "無法讀取模型清單。", {
      kind: evidenceKind,
      summary: modelsProbe.error.message,
      latencyMs: modelsProbe.latencyMs,
      httpStatus: null,
      errorCode: modelsProbe.error.code,
    });
  } else {
    const response = modelsProbe.value!;
    if (!response.ok) {
      mark(api, "reachable", "Hermes API 有回應。", {
        kind: evidenceKind,
        summary: "HTTP " + response.status,
        latencyMs: modelsProbe.latencyMs,
        httpStatus: response.status,
        errorCode: "upstream_" + response.status,
      }, modelsProbe.latencyMs);
      mark(
        auth,
        [401, 403].includes(response.status) ? "failed" : "unknown",
        [401, 403].includes(response.status)
          ? "Hermes 金鑰無效或權限不足。"
          : "模型清單回應異常。",
        {
          kind: evidenceKind,
          summary: "HTTP " + response.status,
          latencyMs: modelsProbe.latencyMs,
          httpStatus: response.status,
          errorCode: "upstream_" + response.status,
        },
        modelsProbe.latencyMs,
      );
      mark(models, "failed", "模型清單不是成功回應。", {
        kind: evidenceKind,
        summary: "HTTP " + response.status,
        latencyMs: modelsProbe.latencyMs,
        httpStatus: response.status,
        errorCode: "upstream_" + response.status,
      });
      await response.body?.cancel();
    } else {
      try {
        const payload = await readJSON(response);
        const ids = Array.isArray((payload as { data?: { id?: string }[] }).data)
          ? (payload as { data: { id?: string }[] }).data
              .map((item) => item.id)
              .filter((id): id is string => !!id)
          : [];
        mark(api, "reachable", "Hermes API 可連線。", {
          kind: evidenceKind,
          summary: "GET /v1/models 成功。",
          latencyMs: modelsProbe.latencyMs,
          httpStatus: 200,
          errorCode: null,
        }, modelsProbe.latencyMs);
        mark(auth, "authenticated", "金鑰通過模型清單認證。", {
          kind: evidenceKind,
          summary: "Authorization 被接受。",
          latencyMs: modelsProbe.latencyMs,
          httpStatus: 200,
          errorCode: null,
        }, modelsProbe.latencyMs);
        mark(
          models,
          ids.length ? "verified" : "failed",
          ids.length
            ? "模型清單已回傳 " + ids.length + " 個模型。"
            : "模型清單為空。",
          {
            kind: evidenceKind,
            summary: ids.length ? ids.slice(0, 5).join("、") : "empty models",
            latencyMs: modelsProbe.latencyMs,
            httpStatus: 200,
            errorCode: ids.length ? null : "empty_models",
          },
          modelsProbe.latencyMs,
        );
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "模型清單無法解析。";
        mark(api, "reachable", "有 HTTP 回應，但內容無效。", {
          kind: evidenceKind,
          summary: message,
          latencyMs: modelsProbe.latencyMs,
          httpStatus: 200,
          errorCode: error instanceof ApiError ? error.code : "invalid_response",
        });
        mark(auth, "authenticated", "金鑰被接受，但模型清單無法解析。", {
          kind: evidenceKind,
          summary: message,
          latencyMs: modelsProbe.latencyMs,
          httpStatus: 200,
          errorCode: error instanceof ApiError ? error.code : "invalid_response",
        });
        mark(models, "failed", message, {
          kind: evidenceKind,
          summary: message,
          latencyMs: modelsProbe.latencyMs,
          httpStatus: 200,
          errorCode: error instanceof ApiError ? error.code : "invalid_response",
        });
      }
    }
  }

  let features: Record<string, boolean> = {};
  const capProbe = await timed(() => upstream("/v1/capabilities"));
  if (capProbe.value?.ok) {
    try {
      const data = await readJSON(capProbe.value);
      if (data.features && typeof data.features === "object") {
        features = Object.fromEntries(
          Object.entries(data.features as Record<string, unknown>).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
          ),
        );
      }
    } catch {
      /* listing failure does not certify chat/runs */
    }
  } else {
    await capProbe.value?.body?.cancel();
  }

  const lists = await Promise.all([
    timed(async () => readJSON(await upstream("/v1/skills"))),
    timed(async () => readJSON(await upstream("/v1/toolsets"))),
  ]);
  const skillNames =
    lists[0].value && Array.isArray(lists[0].value)
      ? (lists[0].value as { name?: string }[]).map((item) => item.name).filter(Boolean)
      : lists[0].value && Array.isArray((lists[0].value as { data?: unknown }).data)
        ? ((lists[0].value as { data: { name?: string }[] }).data || [])
            .map((item) => item.name)
            .filter(Boolean)
        : [];
  const toolsets =
    lists[1].value && Array.isArray(lists[1].value)
      ? (lists[1].value as { name?: string; tools?: string[] }[])
      : lists[1].value && Array.isArray((lists[1].value as { data?: unknown }).data)
        ? ((lists[1].value as { data: { name?: string; tools?: string[] }[] }).data || [])
        : [];
  const listedTools = toolsets.flatMap((item) => item.tools || []);

  if (skillNames.length) {
    mark(skills, "partial", "已列出 " + skillNames.length + " 個 skills；列出不是執行驗證。", {
      kind: evidenceKind,
      summary: "GET /v1/skills",
      latencyMs: lists[0].latencyMs,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(skills, features.skills === false ? "unsupported" : "unknown", "尚未取得可執行的 skill 證據。", {
      kind: evidenceKind,
      summary: "skills list empty or unavailable",
      latencyMs: lists[0].latencyMs,
      httpStatus: null,
      errorCode: lists[0].error?.code || null,
    });
  }

  if (listedTools.length) {
    mark(tools, "partial", "工具清單有 " + listedTools.length + " 項；尚未證明實際 tool call。", {
      kind: evidenceKind,
      summary: "GET /v1/toolsets",
      latencyMs: lists[1].latencyMs,
      httpStatus: 200,
      errorCode: null,
    });
  }

  if (features.run_submission === false) {
    mark(runs, "unsupported", "此實例宣告不支援 run submission。", {
      kind: evidenceKind,
      summary: "capabilities.run_submission=false",
      latencyMs: capProbe.latencyMs,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(runs, "configured", "尚未以真實 run 任務證明。", {
      kind: evidenceKind,
      summary: "capabilities 不能代替 run 執行。",
      latencyMs: capProbe.latencyMs,
      httpStatus: capProbe.value?.ok ? 200 : null,
      errorCode: null,
    });
  }
  if (features.run_status === false) {
    mark(runStatus, "unsupported", "此實例宣告不支援 run status。", {
      kind: evidenceKind,
      summary: "capabilities.run_status=false",
      latencyMs: capProbe.latencyMs,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(runStatus, "configured", "尚未以查回遠端 run 證明。", {
      kind: evidenceKind,
      summary: "capabilities 不能代替 status 查詢。",
      latencyMs: capProbe.latencyMs,
      httpStatus: capProbe.value?.ok ? 200 : null,
      errorCode: null,
    });
  }
  if (features.run_stop === false) {
    mark(cancel, "unsupported", "此實例宣告不支援 stop。", {
      kind: evidenceKind,
      summary: "capabilities.run_stop=false",
      latencyMs: capProbe.latencyMs,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(cancel, "configured", "尚未以真實停止請求證明。", {
      kind: evidenceKind,
      summary: "capabilities 不能代替 cancel。",
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  }

  mark(chat, "configured", "尚未以完成的 chat 任務證明。模型清單成功不是 Chat verified。", {
    kind: evidenceKind,
    summary: "waiting for completed chat task",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  mark(streaming, "unknown", "尚未證明串流事件。", {
    kind: evidenceKind,
    summary: "no stream evidence",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });

  const mcpListed = listedTools.some((name) => /mcp/i.test(name)) ||
    toolsets.some((item) => /mcp/i.test(item.name || ""));
  if (mcpListed) {
    mark(mcp, "partial", "工具清單出現 MCP；列出不是每個 MCP 工具已驗證。", {
      kind: evidenceKind,
      summary: "toolset name match",
      latencyMs: lists[1].latencyMs,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(mcp, "unknown", "尚未證明 Hermes 已接上 MCP。", {
      kind: evidenceKind,
      summary: "no mcp toolset evidence",
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  }

  if (features.memory === false || features.memory_provider === false) {
    mark(memory, "unsupported", "此實例宣告沒有遠端 memory。", {
      kind: evidenceKind,
      summary: "capabilities.memory=false",
      latencyMs: capProbe.latencyMs,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(memory, "unknown", "沒有 write 後 read-back，不能標 remote_verified。", {
      kind: evidenceKind,
      summary: "no memory read-back",
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  }

  if (process.env.HERMES_IMAGE_INPUT === "true") {
    mark(image, "configured", "管理者聲明支援圖片輸入，尚未以真實附件任務證明。", {
      kind: evidenceKind,
      summary: "HERMES_IMAGE_INPUT=true is an assertion",
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  } else {
    mark(image, "unsupported", "未啟用圖片輸入。", {
      kind: "UNVERIFIED",
      summary: "HERMES_IMAGE_INPUT is not true",
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  }

  mark(usage, "unknown", "尚未從完成任務讀到 token 用量。", {
    kind: evidenceKind,
    summary: "no usage evidence",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });

  const tasks = hermesTasks(owner);
  const kind = taskEvidenceKind(owner);
  const completedChat = tasks.find(
    (item) => item.transport === "chat" && item.state === "completed" && item.output.trim(),
  );
  if (completedChat) {
    mark(chat, "verified", "已有完成的 chat 任務。這只驗證 Chat，不是整個 Hermes。", {
      kind,
      summary: "task " + completedChat.id,
      latencyMs: completedChat.usage.durationMs,
      httpStatus: 200,
      errorCode: null,
    });
    mark(streaming, "partial", "chat 任務完成；未單獨證明每一個 SSE frame。", {
      kind,
      summary: "completed chat is not a stream contract",
      latencyMs: completedChat.usage.durationMs,
      httpStatus: null,
      errorCode: null,
    });
  }
  const completedRun = tasks.find(
    (item) => item.transport === "runs" && item.remoteId && item.state === "completed",
  );
  if (completedRun) {
    mark(runs, "verified", "已有完成的 native run。", {
      kind,
      summary: "run " + completedRun.remoteId,
      latencyMs: completedRun.usage.durationMs,
      httpStatus: 200,
      errorCode: null,
    });
    mark(runStatus, "verified", "已成功查回遠端 run 狀態。", {
      kind,
      summary: "reconciled " + completedRun.remoteId,
      latencyMs: completedRun.usage.durationMs,
      httpStatus: 200,
      errorCode: null,
    });
  }
  const cancelled = tasks.find(
    (item) => item.stopSupported && (item.state === "cancelled" || item.state === "stopping"),
  );
  if (cancelled) {
    mark(cancel, "verified", "已送出並記錄停止。", {
      kind,
      summary: "task " + cancelled.id,
      latencyMs: null,
      httpStatus: 200,
      errorCode: null,
    });
  }
  const toolEvent = tasks
    .flatMap((item) => item.events)
    .find(
      (event) =>
        !!event.toolName && ["completed", "tool.completed"].includes(event.status),
    );
  if (toolEvent) {
    mark(tools, "verified", "已有完成的工具事件 " + toolEvent.toolName + "。", {
      kind,
      summary: toolEvent.toolName || "tool",
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  }
  const usageTask = tasks.find(
    (item) => item.state === "completed" && item.usage.totalTokens !== null,
  );
  if (usageTask) {
    mark(usage, "partial", "已記錄任務 token，不是供應商帳單。", {
      kind,
      summary: String(usageTask.usage.totalTokens) + " tokens",
      latencyMs: usageTask.usage.durationMs,
      httpStatus: null,
      errorCode: null,
    });
  }

  return finish(report);
}

async function certifyZeabur(): Promise<IntegrationCertification> {
  const report = emptyIntegration("zeabur");
  const tokenCap = findCapability(report, "zeabur.token");
  const identity = findCapability(report, "zeabur.identity");
  const project = findCapability(report, "zeabur.project");
  const service = findCapability(report, "zeabur.service");
  const environment = findCapability(report, "zeabur.environment");
  const variables = findCapability(report, "zeabur.variables");
  const publicStatus = zeaburPublicStatus();
  const kind = kindFor(runtimeEnv("ZEABUR_API_URL") || publicStatus.endpoint);

  if (!publicStatus.token.configured) {
    for (const cap of report.capabilities) {
      mark(cap, "unknown", "尚未保存 Zeabur API 權杖。", null);
    }
    return finish(report);
  }
  mark(tokenCap, "configured", "已保存權杖（" + (publicStatus.token.source || "unknown") + "）。", {
    kind,
    summary: "token present, not yet authenticated",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });

  const me = await timed(() => testZeabur());
  if (me.error) {
    mark(tokenCap, "failed", me.error.message, {
      kind,
      summary: me.error.message,
      latencyMs: me.latencyMs,
      httpStatus: null,
      errorCode: me.error.code,
    });
    mark(identity, "failed", me.error.message, {
      kind,
      summary: me.error.message,
      latencyMs: me.latencyMs,
      httpStatus: null,
      errorCode: me.error.code,
    });
    return finish(report);
  }
  mark(tokenCap, "authenticated", "權杖可呼叫 Zeabur GraphQL。", {
    kind,
    summary: "query me",
    latencyMs: me.latencyMs,
    httpStatus: 200,
    errorCode: null,
  }, me.latencyMs);
  mark(identity, "verified", me.value?.identity || "已驗證操作者", {
    kind,
    summary: "query me",
    latencyMs: me.latencyMs,
    httpStatus: 200,
    errorCode: null,
  }, me.latencyMs);

  if (!runtimeEnv("ZEABUR_PROJECT_ID")) {
    mark(project, "unknown", "尚未保存專案識別。", null);
  } else if (me.value?.targetName) {
    mark(project, "verified", "可讀取專案。", {
      kind,
      summary: "project query",
      latencyMs: me.latencyMs,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(project, "failed", "已保存專案識別，但讀取失敗。", {
      kind,
      summary: "project unreadable",
      latencyMs: me.latencyMs,
      httpStatus: null,
      errorCode: "zeabur_project",
    });
  }

  const listed = await timed(() => listZeaburProjects());
  if (!listed.error && (listed.value?.projects.length || 0) > 0) {
    if (project.status !== "verified") {
      mark(project, "partial", "可列出專案，尚未對上已保存的專案識別。", {
        kind,
        summary: String(listed.value!.projects.length) + " projects",
        latencyMs: listed.latencyMs,
        httpStatus: 200,
        errorCode: null,
      });
    }
    const first = listed.value!.projects[0];
    if (first.services.length) {
      mark(
        service,
        runtimeEnv("ZEABUR_SERVICE_ID") ? "verified" : "partial",
        runtimeEnv("ZEABUR_SERVICE_ID")
          ? "服務識別可對應。"
          : "可列出服務，尚未保存服務識別。",
        {
          kind,
          summary: "projects.services",
          latencyMs: listed.latencyMs,
          httpStatus: 200,
          errorCode: null,
        },
      );
    } else {
      mark(service, runtimeEnv("ZEABUR_SERVICE_ID") ? "configured" : "unknown", "專案回應沒有服務清單。", {
        kind,
        summary: "no services in list payload",
        latencyMs: listed.latencyMs,
        httpStatus: 200,
        errorCode: null,
      });
    }
    if (first.environments.length) {
      mark(
        environment,
        runtimeEnv("ZEABUR_ENVIRONMENT_ID") ? "verified" : "partial",
        runtimeEnv("ZEABUR_ENVIRONMENT_ID")
          ? "環境識別可對應。"
          : "可列出環境，尚未保存環境識別。",
        {
          kind,
          summary: "projects.environments",
          latencyMs: listed.latencyMs,
          httpStatus: 200,
          errorCode: null,
        },
      );
    } else {
      mark(
        environment,
        runtimeEnv("ZEABUR_ENVIRONMENT_ID") ? "configured" : "unknown",
        "專案回應沒有環境清單。",
        {
          kind,
          summary: "no environments in list payload",
          latencyMs: listed.latencyMs,
          httpStatus: 200,
          errorCode: null,
        },
      );
    }
  } else if (listed.error) {
    mark(project, project.status === "verified" ? "verified" : "failed", listed.error.message, {
      kind,
      summary: listed.error.message,
      latencyMs: listed.latencyMs,
      httpStatus: null,
      errorCode: listed.error.code,
    });
  }

  if (!runtimeEnv("ZEABUR_SERVICE_ID") || !runtimeEnv("ZEABUR_ENVIRONMENT_ID")) {
    mark(variables, "unknown", "需要服務與環境識別才能讀變數鍵名。", null);
  } else {
    const vars = await timed(() => listZeaburVariables());
    if (vars.error) {
      mark(variables, "failed", vars.error.message, {
        kind,
        summary: vars.error.message,
        latencyMs: vars.latencyMs,
        httpStatus: null,
        errorCode: vars.error.code,
      });
    } else {
      mark(variables, "verified", "可讀取 " + (vars.value?.keys.length || 0) + " 個變數鍵名（不含值）。", {
        kind,
        summary: "variables { key }",
        latencyMs: vars.latencyMs,
        httpStatus: 200,
        errorCode: null,
      });
    }
  }
  return finish(report);
}

function certifyMemory(owner: string, health?: Health): IntegrationCertification {
  const report = emptyIntegration("memory");
  const local = findCapability(report, "memory.local");
  const mcp = findCapability(report, "memory.mcp");
  const remote = findCapability(report, "memory.remote");
  const share = memoryShareStatus(owner, health);
  const count = listMemories(owner).length;
  mark(local, "verified", "Console SQLite 共用記憶可用，目前 " + count + " 筆。synced=false。", {
    kind: "LOCAL_CONTRACT",
    summary: share.store,
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  mark(
    mcp,
    credentialPresence("MCP_BRIDGE_TOKEN").configured ? "partial" : "unknown",
    credentialPresence("MCP_BRIDGE_TOKEN").configured
      ? "Workspace MCP 與 SQLite 同一庫；列出工具不是遠端同步。"
      : "尚未設定 MCP 橋接權杖。",
    {
      kind: "UNVERIFIED",
      summary: share.sharedVia.join(","),
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    },
  );
  if (share.hermesRemote === "unsupported") {
    mark(remote, "unsupported", "Hermes 未提供遠端 memory。", {
      kind: "UNVERIFIED",
      summary: share.hermesRemote,
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  } else {
    mark(remote, "unknown", share.notice, {
      kind: "UNVERIFIED",
      summary: "synced=" + String(share.synced),
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  }
  return finish(report);
}

function certifyTamkang(): IntegrationCertification {
  const report = emptyIntegration("tamkang");
  const configured = findCapability(report, "tamkang.configured");
  const reachable = findCapability(report, "tamkang.reachable");
  const tools = findCapability(report, "tamkang.tools");
  const read = findCapability(report, "tamkang.read");
  if (!tamkangConfigured()) {
    mark(configured, "unknown", "尚未設定 TKU_MCP_URL 與 TKU_MCP_TOKEN。", null);
    mark(reachable, "unknown", "未設定，未探測。", null);
    mark(tools, "unknown", "未設定，未列出工具。", null);
    mark(read, "unknown", "沒有安全讀取證據。", null);
    return finish(report);
  }
  mark(configured, "configured", "已設定淡江 MCP 連線資料。", {
    kind: kindFor(runtimeEnv("TKU_MCP_URL")),
    summary: "url+token present",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  const entry = seedRegistry().find((item) => item.id === "tku");
  if (entry?.status === "failed") {
    mark(reachable, "failed", entry.lastError || "淡江 MCP 探測失敗。", {
      kind: kindFor(entry.endpoint),
      summary: entry.lastError || "failed",
      latencyMs: null,
      httpStatus: null,
      errorCode: "mcp_failed",
    });
  } else if (entry && entry.tools.length) {
    mark(reachable, "reachable", "已通過 initialize／tools/list。", {
      kind: kindFor(entry.endpoint),
      summary: "status=" + entry.status,
      latencyMs: null,
      httpStatus: 200,
      errorCode: null,
    });
    mark(tools, "partial", "已列出 " + entry.tools.length + " 個工具；不是已執行。", {
      kind: kindFor(entry.endpoint),
      summary: "tools/list",
      latencyMs: null,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(reachable, "configured", "已設定，本次未重新探測 MCP。", {
      kind: kindFor(runtimeEnv("TKU_MCP_URL")),
      summary: "no stored probe",
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
    mark(tools, "unknown", "沒有已保存的 tools/list。", null);
  }
  mark(read, "unknown", "沒有安全讀取工具的執行證據，不得標 verified。", {
    kind: "UNVERIFIED",
    summary: "no safe-read",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  return finish(report);
}

function certifyCanva(owner: string): IntegrationCertification {
  const report = emptyIntegration("canva");
  const configured = findCapability(report, "canva.configured");
  const listCap = findCapability(report, "canva.list");
  const create = findCapability(report, "canva.create");
  const status = canvaStatus(owner);
  if (!canvaConfigured()) {
    mark(configured, "unknown", "尚未設定 Canva OAuth。", null);
    mark(listCap, "unknown", "未授權。", null);
    mark(create, "unknown", "未授權，不得假裝製作成功。", null);
    return finish(report);
  }
  mark(configured, "configured", "已設定 Client ID／Secret。", {
    kind: "UNVERIFIED",
    summary: "oauth configured",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  if (status.state === "partial") {
    mark(listCap, "partial", status.message, {
      kind: "UNVERIFIED",
      summary: "list designs only",
      latencyMs: null,
      httpStatus: 200,
      errorCode: null,
    });
  } else {
    mark(listCap, "unknown", status.message, {
      kind: "UNVERIFIED",
      summary: status.state,
      latencyMs: null,
      httpStatus: null,
      errorCode: null,
    });
  }
  mark(create, "unknown", "建立／autofill／匯出尚未逐項證明。", {
    kind: "UNVERIFIED",
    summary: "not auto-certified",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  return finish(report);
}

function certifyMcp(): IntegrationCertification {
  const report = emptyIntegration("mcp");
  const bridge = findCapability(report, "mcp.bridge");
  const workspace = findCapability(report, "mcp.workspace");
  if (!credentialPresence("MCP_BRIDGE_TOKEN").configured) {
    mark(bridge, "unknown", "尚未設定 MCP_BRIDGE_TOKEN。", null);
    mark(workspace, "unknown", "沒有橋接權杖。", null);
    return finish(report);
  }
  mark(bridge, "configured", "已設定 Workspace MCP 橋接權杖。", {
    kind: "UNVERIFIED",
    summary: "token present",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  mark(workspace, "partial", "Workspace MCP 路徑存在；Hermes 是否已接入未在此證明。", {
    kind: "LOCAL_CONTRACT",
    summary: "/api/mcp",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  return finish(report);
}

function certifyResearch(): IntegrationCertification {
  const report = emptyIntegration("research");
  mark(findCapability(report, "research.plan"), "verified", "可產生未執行的研究計畫（executed=false）。", {
    kind: "LOCAL_UNIT",
    summary: "researchBundle plan constructor",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  mark(findCapability(report, "research.execute"), "partial", "可抓取允許清單內的官方頁面；不是完整文獻檢索。", {
    kind: "LOCAL_UNIT",
    summary: "allowlisted fetch executor",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  mark(findCapability(report, "research.sources"), "unknown", "沒有外部 evidence，不得標 executed=true。", {
    kind: "UNVERIFIED",
    summary: "sources empty",
    latencyMs: null,
    httpStatus: null,
    errorCode: null,
  });
  return finish(report);
}

export async function runCertification(
  owner = WORKSPACE_OWNER,
  ids?: IntegrationId[],
): Promise<CertificationReport> {
  const selected = ids?.length ? ids : allIntegrationIds();
  const previous = loadReport(owner);
  const next = emptyReport();
  next.integrations = previous.integrations.map((item) => ({
    ...item,
    capabilities: item.capabilities.map((cap) => ({ ...cap })),
  }));
  const replace = (item: IntegrationCertification) => {
    next.integrations = next.integrations.map((current) =>
      current.id === item.id ? item : current,
    );
  };
  for (const id of selected) {
    if (id === "hermes") replace(await certifyHermes(owner));
    else if (id === "zeabur") replace(await certifyZeabur());
    else if (id === "memory") replace(certifyMemory(owner));
    else if (id === "tamkang") replace(certifyTamkang());
    else if (id === "canva") replace(certifyCanva(owner));
    else if (id === "mcp") replace(certifyMcp());
    else if (id === "research") replace(certifyResearch());
  }
  next.checkedAt = nowIso();
  saveReport(owner, next);
  return next;
}

export function getCertification(owner = WORKSPACE_OWNER) {
  return loadReport(owner);
}
