import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { ApiError } from "./security";

const privateV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  privateV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const reservedV6 = new BlockList();
reservedV6.addSubnet("2001::", 23, "ipv6");
reservedV6.addSubnet("2001:db8::", 32, "ipv6");
reservedV6.addSubnet("2002::", 16, "ipv6");
export function publicMcpAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !privateV4.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !reservedV6.check(address, "ipv6");
}
type Resolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;
export async function resolveMcpTarget(
  url: URL,
  resolver: Resolver = (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const loopback =
    process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" &&
    ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
  )
    throw new ApiError(503, "invalid_mcp_target", "MCP 需要受控 HTTPS 端點。");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolver(hostname);
  if (
    !addresses.length ||
    addresses.some(
      (item) =>
        !publicMcpAddress(item.address) &&
        !(loopback && ["127.0.0.1", "::1"].includes(item.address)),
    )
  )
    throw new ApiError(
      503,
      "mcp_private_target",
      "MCP 目標解析至私網、保留位址或中繼資料服務，已阻擋。",
    );
  return addresses[0];
}

// Resolve, validate and pin the selected IP into the socket lookup. TLS still
// verifies the original hostname. Never follow redirects or forward credentials.
export const safeMcpFetch: typeof fetch = async (input, init) => {
  const source = new Request(input, init);
  const url = new URL(source.url);
  source.signal.throwIfAborted();
  let abort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(source.signal.reason);
    source.signal.addEventListener("abort", abort, { once: true });
  });
  const address = await Promise.race([
    resolveMcpTarget(url),
    interrupted,
  ]).finally(() => source.signal.removeEventListener("abort", abort));
  source.signal.throwIfAborted();
  const body = source.body
    ? Buffer.from(await source.arrayBuffer())
    : undefined;
  if (body && body.length > 1_000_000) throw new Error("MCP request limit");
  const headers = Object.fromEntries(source.headers);
  delete headers.host;
  return await new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: source.method,
        headers,
        signal: source.signal,
        family: address.family,
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
      },
      (response) => {
        const status = response.statusCode || 502;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new Error("MCP redirect blocked"));
          return;
        }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers))
          if (value !== undefined)
            responseHeaders.set(
              key,
              Array.isArray(value) ? value.join(", ") : value,
            );
        if ([204, 205, 304].includes(status) || source.method === "HEAD") {
          response.resume();
          resolve(new Response(null, { status, headers: responseHeaders }));
        } else
          resolve(
            new Response(
              Readable.toWeb(response) as ReadableStream<Uint8Array>,
              { status, headers: responseHeaders },
            ),
          );
      },
    );
    request.once("error", reject);
    request.end(body);
  });
};
