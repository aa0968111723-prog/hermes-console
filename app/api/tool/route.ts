import { ApiError, authenticate, route } from "@/lib/server/security";
export const POST = route(async (request) => {
  authenticate(request, true);
  throw new ApiError(
    410,
    "legacy_tool_disabled",
    "已移除本地工具執行介面。工具由 Hermes 依真實協定執行，不接受文字工具標籤。",
  );
});
