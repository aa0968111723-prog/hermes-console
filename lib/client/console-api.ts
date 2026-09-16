export async function consoleApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    throw new Error(
      method === "GET"
        ? "暫時無法取得資料，請檢查連線後重試。"
        : "未收到操作結果。請先查看已保存的任務或素材，再決定是否重試。",
    );
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      (data as { error?: { message?: string } }).error?.message ||
        "操作失敗，請稍後重試。",
    );
  return data as T;
}
