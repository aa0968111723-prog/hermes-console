import type { BrowserContext } from "@playwright/test";

export async function registerOwner(
  base: string,
  headers: Record<string, string> = {},
) {
  const response = await fetch(base + "/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...headers,
    },
    body: JSON.stringify({
      action: "register",
      email: "owner@example.test",
      password: "Test-Password-14",
      name: "測試擁有者",
    }),
  });
  const setCookie = response.headers.get("set-cookie") || "";
  const token = /hermes_session=([a-f0-9]{64})/.exec(setCookie)?.[1];
  if (!response.ok || !token)
    throw new Error(
      "test owner register failed: " + response.status + " " + setCookie,
    );
  return token;
}

export async function bootstrapOwner(
  base: string,
  context: Pick<BrowserContext, "addCookies">,
  options?: { cookieUrl?: string; headers?: Record<string, string> },
) {
  const token = await registerOwner(base, options?.headers);
  await context.addCookies([
    {
      name: "hermes_session",
      value: token,
      url: options?.cookieUrl || base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return token;
}
