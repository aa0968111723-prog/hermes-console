import { validateSsrfSafeUrl } from "../security.ts";
import { callRemoteMcpToolViaSdk } from "./client.ts";

/**
 * 淡江大學專用 MCP 適配器 (Tamkang MCP Adapter)
 * 提供淡江大學校園地標、社團茶會時程、大一新生作息與迎新洞察
 */

export interface TkuCalendarEvent {
  week: number;
  title: string;
  dateRange: string;
  audienceMindset: string;
  strategicOpportunity: string;
}

export interface TkuVenueInfo {
  venueId: string;
  name: string;
  location: string;
  capacity: number;
  vibe: string;
  teaPartyFitScore: number;
  tips: string;
}

// 淡江校園真實活動行事曆資料
const TKU_SEMESTER_CALENDAR: TkuCalendarEvent[] = [
  {
    week: 1,
    title: "大一新生始業式與社團博覽會",
    dateRange: "開學第 1 週",
    audienceMindset: "對大學生活感到興奮又迷惘，被五花八門的攤位資訊轟炸，容易產生資訊疲乏。",
    strategicOpportunity: "攤位避免吵鬧大聲公叫賣，以清香冷泡茶與精緻小書籤吸引想喘口氣的新生。"
  },
  {
    week: 2,
    title: "第一波加退選與新生茶會高峰",
    dateRange: "開學第 2 週",
    audienceMindset: "為了選課系統抓狂、通勤爬坡感到疲累，開始渴望結交固定好友或組學習夥伴。",
    strategicOpportunity: "茶會宣傳強打『淡江選課不踩雷攻略交流』與『克難坡腿酸急救心靈茶席』。"
  },
  {
    week: 3,
    title: "課業步入正軌與迎新晚會",
    dateRange: "開學第 3 週",
    audienceMindset: "夜衝、社團試聽排滿，部分內向學生開始感到社交倦怠（Social Fatigue）。",
    strategicOpportunity: "提供『零尷尬破冰』、『想靜靜喝杯好茶就來』的友善保證。"
  },
  {
    week: 8,
    title: "期中考前衝刺週",
    dateRange: "第 8 週",
    audienceMindset: "大學第一次期中考焦慮爆發，熬夜讀書、大腦過熱需要放鬆專注技巧。",
    strategicOpportunity: "主打 15 分鐘呼吸專注法與期中考祈福好茶。"
  }
];

// 淡江社團茶會精選場地
const TKU_CLUB_VENUES: TkuVenueInfo[] = [
  {
    venueId: "gongdeng_lawn",
    name: "宮燈教室長廊與後方草坪",
    location: "淡江大學宮燈大道",
    capacity: 25,
    vibe: "古色古香、綠蔭微風、日光灑落，絕佳文青感",
    teaPartyFitScore: 95,
    tips: "傍晚 16:30-18:00 暮色與宮燈亮起時氣氛最美，適合品茗與輕聲交談。"
  },
  {
    venueId: "fuyuan_pavilion",
    name: "福園觀魚涼亭",
    location: "福園黑天鵝池畔",
    capacity: 15,
    vibe: "水波悠悠、黑天鵝悠游，自帶寧靜冥想氛圍",
    teaPartyFitScore: 88,
    tips: "開放空間戶外微風舒適，建議自備坐墊與環保茶杯。"
  },
  {
    venueId: "activity_center_b307",
    name: "學生活動中心多功能社團教室 B307",
    location: "學生活動中心 3 樓",
    capacity: 40,
    vibe: "木質地板、冷氣充足、音響設備完備，適合坐禪與團康互動",
    teaPartyFitScore: 92,
    tips: "需提前一週向課外活動輔導組提出場地借用申請。"
  },
  {
    venueId: "jueshuan_garden",
    name: "覺軒花園中庭",
    location: "驚聲紀念大樓旁",
    capacity: 30,
    vibe: "江南園林風格、迴廊造景，極具禪意意境",
    teaPartyFitScore: 90,
    tips: "遮雨迴廊在淡水多雨季節極具優勢。"
  }
];

/**
 * 查詢淡江行事曆與新生心理狀態
 */
export async function queryTkuCalendar(week?: number) {
  const remoteUrl = process.env.TKU_MCP_URL;
  if (remoteUrl) {
    const ssrf = validateSsrfSafeUrl(
      remoteUrl,
      process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" || process.env.NODE_ENV !== "production"
    );
    if (ssrf.safe) {
      try {
        // 優先透過標準 MCP SDK Client 連線調用
        const sdkRes = await callRemoteMcpToolViaSdk(
          remoteUrl,
          "query_tku_calendar",
          { week: week ?? 2 },
          { token: process.env.TKU_MCP_TOKEN, timeoutMs: 3500 }
        );
        if (sdkRes.success && sdkRes.result) {
          return sdkRes.result;
        }

        const rpcPayload = {
          jsonrpc: "2.0",
          id: `mcp_tku_${Date.now()}`,
          method: "tools/call",
          params: {
            name: "query_tku_calendar",
            arguments: { week: week ?? 2 }
          }
        };

        const res = await fetch(remoteUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.TKU_MCP_TOKEN || ""}`
          },
          body: JSON.stringify(rpcPayload),
          signal: AbortSignal.timeout(4000)
        });

        if (res.ok) {
          const rpcRes = await res.json().catch(() => null);
          if (rpcRes) {
            if (rpcRes.result?.content?.[0]?.text) {
              try {
                return JSON.parse(rpcRes.result.content[0].text);
              } catch {
                return rpcRes.result.content[0].text;
              }
            }
            if (rpcRes.result) return rpcRes.result;
          }
        }
      } catch {
        // 遠端若超時或失敗，自動平滑回退至本機資料庫
      }
    }
  }

  if (week) {
    const local = TKU_SEMESTER_CALENDAR.find((c) => c.week === week) || TKU_SEMESTER_CALENDAR[1];
    return {
      ...local,
      source: "console_notes" as const,
      mcpVerified: false,
      sourceLayer: "console_local_notes" as const,
      isRemoteMcp: false,
      note: "本機校園筆記，非遠端 MCP 伺服器輸出",
    };
  }
  return TKU_SEMESTER_CALENDAR.map((item) => ({
    ...item,
    source: "console_notes" as const,
    mcpVerified: false,
    sourceLayer: "console_local_notes" as const,
    isRemoteMcp: false,
    note: "本機校園筆記，非遠端 MCP 伺服器輸出",
  }));
}

/**
 * 查詢淡江社團場地情報
 */
export async function queryTkuVenues(venueId?: string) {
  const remoteUrl = process.env.TKU_MCP_URL;
  if (remoteUrl) {
    const ssrf = validateSsrfSafeUrl(
      remoteUrl,
      process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" || process.env.NODE_ENV !== "production"
    );
    if (ssrf.safe) {
      try {
        // 優先透過標準 MCP SDK Client 連線調用
        const sdkRes = await callRemoteMcpToolViaSdk(
          remoteUrl,
          "query_tku_venues",
          { venueId: venueId || "" },
          { token: process.env.TKU_MCP_TOKEN, timeoutMs: 3500 }
        );
        if (sdkRes.success && sdkRes.result) {
          return sdkRes.result;
        }

        const rpcPayload = {
          jsonrpc: "2.0",
          id: `mcp_tku_venue_${Date.now()}`,
          method: "tools/call",
          params: {
            name: "query_tku_venues",
            arguments: { venueId: venueId || "" }
          }
        };

        const res = await fetch(remoteUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.TKU_MCP_TOKEN || ""}`
          },
          body: JSON.stringify(rpcPayload),
          signal: AbortSignal.timeout(4000)
        });

        if (res.ok) {
          const rpcRes = await res.json().catch(() => null);
          if (rpcRes) {
            if (rpcRes.result?.content?.[0]?.text) {
              try {
                return JSON.parse(rpcRes.result.content[0].text);
              } catch {
                return rpcRes.result.content[0].text;
              }
            }
            if (rpcRes.result) return rpcRes.result;
          }
        }
      } catch {
        // 遠端若超時，平滑回退
      }
    }
  }

  if (venueId) {
    const local =
      TKU_CLUB_VENUES.find((v) => v.venueId === venueId || v.name.includes(venueId)) ||
      TKU_CLUB_VENUES[0];
    return {
      ...local,
      source: "console_notes" as const,
      mcpVerified: false,
      sourceLayer: "console_local_notes" as const,
      isRemoteMcp: false,
      note: "本機校園筆記，非遠端 MCP 伺服器輸出",
    };
  }
  return TKU_CLUB_VENUES.map((item) => ({
    ...item,
    source: "console_notes" as const,
    mcpVerified: false,
    sourceLayer: "console_local_notes" as const,
    isRemoteMcp: false,
    note: "本機校園筆記，非遠端 MCP 伺服器輸出",
  }));
}

/**
 * 取得淡江領袖禪學社背景與茶會定位
 */
export function getTkuZenClubProfile() {
  return {
    clubName: "淡江大學領袖禪學社",
    shortName: "淡江禪學社",
    foundedYear: 2001,
    motto: "專注放鬆・心靈充電・卓越領袖",
    typicalTeaPartySchedule: {
      checkIn: "18:30 - 18:45 迎賓特調茶飲與破冰交流",
      opening: "18:45 - 19:05 大學生活生存指南（學長姐無私經驗傳授）",
      experience: "19:05 - 19:35 5分鐘一秒關掉大腦雜訊：深層呼吸與放鬆禪體驗",
      teaTasting: "19:35 - 20:05 手作茶點品嚐與三色光手作互動",
      closing: "20:05 - 20:20 大合照與專屬紀念祝福書籤領取"
    },
    dressCode: "輕鬆舒適休閒即可，無特殊限制",
    fee: "完全免費（歡迎大一新生攜伴參加）",
    source: "console_notes" as const,
    mcpVerified: false,
    sourceLayer: "console_local_notes" as const,
    isRemoteMcp: false,
    note: "本機校園筆記，非遠端 MCP 伺服器輸出",
  };
}

/**
 * 檢驗淡江資料來源出處 (Truthful Source Provenance)
 */
export function getTkuSourceProvenance(data: unknown): {
  isRemoteMcp: boolean;
  sourceLayer: "remote_mcp" | "console_local_notes" | "unknown";
  note: string;
} {
  if (data && typeof data === "object") {
    const isRemote = (data as Record<string, unknown>).isRemoteMcp === true;
    const layer = (data as Record<string, unknown>).sourceLayer;
    if (isRemote || layer === "remote_mcp") {
      return {
        isRemoteMcp: true,
        sourceLayer: "remote_mcp",
        note: "資料來自遠端驗證通過之 Tamkang MCP 伺服器",
      };
    }
    if (
      layer === "console_local_notes" ||
      (data as Record<string, unknown>).source === "console_notes" ||
      (data as Record<string, unknown>).isRemoteMcp === false
    ) {
      return {
        isRemoteMcp: false,
        sourceLayer: "console_local_notes",
        note: "資料來自 Console 本機校園知識筆記，非遠端 MCP 伺服器輸出",
      };
    }
  }
  return {
    isRemoteMcp: false,
    sourceLayer: "unknown",
    note: "未標記出處之資料來源",
  };
}
