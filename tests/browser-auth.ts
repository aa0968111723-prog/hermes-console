import type { BrowserContext } from "@playwright/test";

const owner = {
  action: "register",
  email: "owner@example.test",
  password: "Test-Password-14",
  name: "測試擁有者",
} as const;

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
    body: JSON.stringify(owner),
  });
  if (response.status === 409) return "";
  const setCookie = response.headers.get("set-cookie") || "";
  const token = /hermes_session=([a-f0-9]{64})/.exec(setCookie)?.[1];
  if (!response.ok || !token)
    throw new Error(
      "test owner register failed: " +
        response.status +
        " " +
        (await response.text()),
    );
  return token;
}

export async function bootstrapOwner(
  base: string,
  context: Pick<BrowserContext, "newPage" | "cookies">,
  options?: { cookieUrl?: string; headers?: Record<string, string> },
) {
  await registerOwner(base, options?.headers);
  const cookieUrl = options?.cookieUrl || base;
  const page = await context.newPage();
  try {
    await page.goto(cookieUrl, { waitUntil: "domcontentloaded" });
    const result = await page.evaluate(async (payload) => {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          email: payload.email,
          password: payload.password,
        }),
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await response.text(),
      };
    }, {
      email: owner.email,
      password: owner.password,
    });
    if (!result.ok)
      throw new Error(
        "test owner login failed: " + result.status + " " + result.body,
      );
    const token = (await context.cookies(cookieUrl)).find(
      (row) => row.name === "hermes_session",
    )?.value;
    if (!token) throw new Error("session cookie missing after in-page login");
    return token;
  } finally {
    await page.close();
  }
}
