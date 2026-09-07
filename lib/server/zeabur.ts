import { ApiError, redact } from "./security";
import { credentialPresence, runtimeEnv } from "./credentials";

const DEFAULT_API = "https://api.zeabur.com/graphql";
const PUSHABLE = [
  "HERMES_API_URL",
  "HERMES_API_KEY",
  "HERMES_MODEL",
  "MCP_BRIDGE_TOKEN",
  "TKU_MCP_URL",
  "TKU_MCP_TOKEN",
  "XUNHE_MCP_URL",
  "XUNHE_MCP_TOKEN",
  "CONSOLE_MCP_SERVERS_JSON",
] as const;

function endpoint() {
  const raw = runtimeEnv("ZEABUR_API_URL") || DEFAULT_API;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, "invalid_url", "Zeabur API 網址格式不正確。");
  }
  const local =
    process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ApiError(400, "invalid_url", "Zeabur API 需為受控 HTTPS 端點。");
  return url.toString();
}

function token() {
  const value = runtimeEnv("ZEABUR_API_TOKEN");
  if (!value)
    throw new ApiError(400, "zeabur_unconfigured", "請先在連線設定保存 Zeabur API 權杖。");
  return value;
}

function serviceIds(override?: {
  projectId?: string;
  serviceId?: string;
  environmentId?: string;
}) {
  const projectId = override?.projectId || runtimeEnv("ZEABUR_PROJECT_ID");
  const serviceId = override?.serviceId || runtimeEnv("ZEABUR_SERVICE_ID");
  const environmentId =
    override?.environmentId || runtimeEnv("ZEABUR_ENVIRONMENT_ID");
  if (!serviceId || !environmentId)
    throw new ApiError(
      400,
      "zeabur_target_missing",
      "請先保存 Zeabur 服務與環境識別。",
    );
  return { projectId, serviceId, environmentId };
}

async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const secret = token();
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, "zeabur_network", "無法連線 Zeabur API。");
  }
  let payload: { data?: T; errors?: Array<{ message?: string }> } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    await response.body?.cancel();
    throw new ApiError(502, "zeabur_invalid", "Zeabur 回應不是有效 JSON。");
  }
  if (!response.ok || payload.errors?.length)
    throw new ApiError(
      response.status === 401 || response.status === 403 ? 502 : 502,
      "zeabur_failed",
      "Zeabur API 拒絕或失敗；未回傳權杖，本機設定未變更。",
    );
  if (!payload.data)
    throw new ApiError(502, "zeabur_empty", "Zeabur API 沒有回傳資料。");
  return payload.data;
}

export function zeaburPublicStatus() {
  return {
    token: credentialPresence("ZEABUR_API_TOKEN"),
    projectId: runtimeEnv("ZEABUR_PROJECT_ID") || "",
    serviceId: runtimeEnv("ZEABUR_SERVICE_ID") || "",
    environmentId: runtimeEnv("ZEABUR_ENVIRONMENT_ID") || "",
    endpoint: DEFAULT_API,
    notice:
      "權杖在 Zeabur 控制台 Settings → API Keys 建立。能開啟此網站的人都可以覆寫權杖並變更部署環境變數。",
  };
}

export async function testZeabur() {
  const data = await graphql<{ me: { username?: string } | null }>(
    "query { me { username } }",
  );
  const username = data.me?.username ? "已驗證操作者" : "已連線";
  let target: { name?: string } | null = null;
  const projectId = runtimeEnv("ZEABUR_PROJECT_ID");
  if (projectId) {
    try {
      const project = await graphql<{
        project: { name?: string } | null;
      }>("query($id: ObjectID!) { project(id: $id) { name } }", {
        id: projectId,
      });
      target = project.project;
    } catch {
      target = null;
    }
  }
  return {
    ok: true,
    identity: username,
    targetName: target?.name || null,
    ...zeaburPublicStatus(),
  };
}

export async function listZeaburProjects() {
  let data: {
    projects: {
      edges: Array<{
        node: {
          _id: string;
          name: string;
          environments?: Array<{ _id: string; name: string }>;
          services?: Array<{ _id: string; name: string }>;
        };
      }>;
    };
  };
  try {
    data = await graphql(
      "query { projects(limit: 30) { edges { node { _id name environments { _id name } services { _id name } } } } }",
    );
  } catch {
    data = await graphql(
      "query { projects(limit: 30) { edges { node { _id name } } } }",
    );
  }
  return {
    projects: (data.projects?.edges || []).map((edge) => ({
      id: edge.node._id,
      name: redact(edge.node.name || ""),
      environments: (edge.node.environments || []).map((item) => ({
        id: item._id,
        name: item.name,
      })),
      services: (edge.node.services || []).map((item) => ({
        id: item._id,
        name: item.name,
      })),
    })),
  };
}

export async function listZeaburVariables(override?: {
  serviceId?: string;
  environmentId?: string;
}) {
  const ids = serviceIds(override);
  const data = await graphql<{
    variables: Array<{ key: string; value?: string }>;
  }>(
    "query($serviceID: ObjectID!, $environmentID: ObjectID!) { variables(serviceID: $serviceID, environmentID: $environmentID) { key } }",
    { serviceID: ids.serviceId, environmentID: ids.environmentId },
  );
  return {
    keys: (data.variables || []).map((item) => item.key).filter(Boolean),
  };
}

export async function updateZeaburVariables(
  variables: Array<{ key: string; value: string }>,
  override?: { serviceId?: string; environmentId?: string },
) {
  const ids = serviceIds(override);
  const data = variables
    .map((item) => ({
      key: item.key.trim(),
      value: item.value,
    }))
    .filter((item) => /^[A-Z][A-Z0-9_]{0,80}$/.test(item.key) && item.value);
  if (!data.length)
    throw new ApiError(400, "invalid_variables", "沒有可寫入的環境變數。");
  await graphql(
    "mutation($serviceID: ObjectID!, $environmentID: ObjectID!, $data: [VariableInput!]!) { updateVariables(serviceID: $serviceID, environmentID: $environmentID, data: $data) { key } }",
    {
      serviceID: ids.serviceId,
      environmentID: ids.environmentId,
      data,
    },
  );
  return { updated: data.map((item) => item.key) };
}

export async function pushConsoleKeysToZeabur(
  keys: string[] = [...PUSHABLE],
  override?: { serviceId?: string; environmentId?: string },
) {
  const allowed = new Set<string>(PUSHABLE);
  const variables = keys
    .filter((key) => allowed.has(key))
    .map((key) => ({ key, value: runtimeEnv(key) }))
    .filter((item) => item.value);
  if (!variables.length)
    throw new ApiError(
      400,
      "nothing_to_push",
      "沒有已設定、可推送到 Zeabur 的 Console 金鑰。",
    );
  return updateZeaburVariables(variables, override);
}

export async function redeployZeabur(override?: {
  serviceId?: string;
  environmentId?: string;
}) {
  const ids = serviceIds(override);
  const data = await graphql<{
    redeployService: { _id?: string; status?: string };
  }>(
    "mutation($id: ObjectID!, $environmentID: ObjectID!) { redeployService(id: $id, environmentID: $environmentID) { _id status } }",
    { id: ids.serviceId, environmentID: ids.environmentId },
  );
  return {
    action: "redeploy" as const,
    deploymentId: data.redeployService?._id || null,
    status: data.redeployService?.status || "unknown",
  };
}

export async function restartZeabur(override?: {
  serviceId?: string;
  environmentId?: string;
}) {
  const ids = serviceIds(override);
  await graphql(
    "mutation($id: ObjectID!, $environmentID: ObjectID!) { restartService(id: $id, environmentID: $environmentID) }",
    { id: ids.serviceId, environmentID: ids.environmentId },
  );
  return { action: "restart" as const, ok: true };
}
