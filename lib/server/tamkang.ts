export const TAMKANG_CAPABILITIES = [
  "tku_search",
  "tku_news",
  "tku_calendar",
  "tku_events",
  "tku_clubs",
  "tku_courses",
  "tku_campus",
  "tku_map",
  "tku_transport",
  "tku_facilities",
  "tku_student_life",
  "tamsui_places",
  "tamsui_food",
  "tamsui_events",
] as const;

export type TamkangCapability = (typeof TAMKANG_CAPABILITIES)[number];

const HINTS: Record<TamkangCapability, RegExp[]> = {
  tku_search: [/search/i, /query/i, /find/i],
  tku_news: [/news/i, /announcement/i],
  tku_calendar: [/calendar/i],
  tku_events: [/event/i],
  tku_clubs: [/club/i, /society/i],
  tku_courses: [/course/i, /class/i, /curriculum/i],
  tku_campus: [/campus/i],
  tku_map: [/map/i],
  tku_transport: [/transport/i, /bus/i, /mrt/i, /traffic/i],
  tku_facilities: [/facilit/i, /building/i, /venue/i],
  tku_student_life: [/student.?life/i, /campus.?life/i],
  tamsui_places: [/tamsui.*place/i, /danshui/i, /place/i],
  tamsui_food: [/food/i, /restaurant/i, /eat/i],
  tamsui_events: [/tamsui.*event/i, /festival/i],
};

export function mapTamkangTools(tools: Array<{ name: string }>) {
  const mapping: Record<TamkangCapability, string | null> = {
    tku_search: null,
    tku_news: null,
    tku_calendar: null,
    tku_events: null,
    tku_clubs: null,
    tku_courses: null,
    tku_campus: null,
    tku_map: null,
    tku_transport: null,
    tku_facilities: null,
    tku_student_life: null,
    tamsui_places: null,
    tamsui_food: null,
    tamsui_events: null,
  };
  for (const capability of TAMKANG_CAPABILITIES) {
    const match = tools.find((tool) =>
      HINTS[capability].some((pattern) => pattern.test(tool.name)),
    );
    mapping[capability] = match?.name || null;
  }
  return mapping;
}

export function tamkangConfigured() {
  return !!(process.env.TKU_MCP_URL && process.env.TKU_MCP_TOKEN);
}

export function tamkangStatus(input?: {
  reachable?: boolean;
  tools?: Array<{ name: string }>;
  verifiedRead?: boolean;
}) {
  if (input?.reachable === false)
    return {
      id: "tku",
      name: "淡江 MCP",
      state: (tamkangConfigured() ? "failed" : "unconfigured") as
        "failed" | "unconfigured",
      detail: tamkangConfigured()
        ? "淡江 MCP 離線；可請 Hermes 使用已授權網頁工具，尚未執行備援查詢。"
        : "尚未設定 TKU_MCP_URL 與 TKU_MCP_TOKEN。",
      mapping: mapTamkangTools(input.tools || []),
      fallback: "web_research",
    };
  if (!tamkangConfigured())
    return {
      id: "tku",
      name: "淡江 MCP",
      state: "unconfigured" as const,
      detail: "尚未設定 TKU_MCP_URL 與 TKU_MCP_TOKEN。",
      mapping: mapTamkangTools([]),
      fallback: "web_research",
    };
  if (input?.verifiedRead)
    return {
      id: "tku",
      name: "淡江 MCP",
      state: "available" as const,
      detail: "已通過安全讀取工具驗證。",
      mapping: mapTamkangTools(input.tools || []),
      fallback: null,
    };
  if (input?.tools?.length)
    return {
      id: "tku",
      name: "淡江 MCP",
      state: "partial" as const,
      detail: "已列出工具，尚未完成安全讀取驗證。",
      mapping: mapTamkangTools(input.tools),
      fallback: null,
    };
  return {
    id: "tku",
    name: "淡江 MCP",
    state: "awaiting_authorization" as const,
    detail: "已設定端點，尚未完成 initialize／tools/list。",
    mapping: mapTamkangTools([]),
    fallback: "web_research",
  };
}

export function unknownMark(value: string | null | undefined) {
  return value && value.trim() ? value : "未知";
}
