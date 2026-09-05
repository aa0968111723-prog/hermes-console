import { profilePathFromUrl, type AgentRole } from "../agents.ts";
import { target as normalizeHermesUrl } from "../hermes.ts";
import { ApiError } from "../security.ts";

const CONSOLE_ROLES = new Set([
  "general",
  "tku",
  "creative",
  "research",
  "design",
  "social",
  "reviewer",
]);
const SKIP_ENV = /^(ALLOW_|CONNECT_|IDLE_|MODEL$|IMAGE_)/;
const KEY_REF = /^HERMES(_[A-Z0-9]+)?_API_KEY$/;

export type FeatureState =
  | "available"
  | "partial"
  | "unsupported"
  | "failed"
  | "unknown";

export type HermesTargetKind = "default" | "named" | "console_role";

export interface HermesNamedProfile {
  id: string;
  kind: "hermes_profile";
  profilePath: string | null;
  credentialReference: string;
  configured: boolean;
  urlConfigured: boolean;
}

export interface HermesTargetResolution {
  ok: boolean;
  profileId: string;
  kind: HermesTargetKind;
  baseUrl: string;
  profilePath: string;
  credentialReference: string;
  configured: boolean;
  fallbackUsed: boolean;
  error?: string;
}

function env(name: string) {
  return (process.env[name] || "").trim();
}

function upperId(id: string) {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function credentialReferenceForProfile(profileId?: string) {
  const id = (profileId || "general").trim();
  if (!id || id === "general") return "HERMES_API_KEY";
  return `HERMES_${upperId(id)}_API_KEY`;
}

export function urlReferenceForProfile(profileId?: string) {
  const id = (profileId || "general").trim();
  if (!id || id === "general") return "HERMES_API_URL";
  return `HERMES_${upperId(id)}_API_URL`;
}

export function readHermesCredential(reference: string) {
  if (!KEY_REF.test(reference)) return "";
  return env(reference);
}

function lookupEnvTarget(profileId: string): {
  url: string;
  credentialReference: string;
} {
  const urlRef = urlReferenceForProfile(profileId);
  const keyRef = credentialReferenceForProfile(profileId);
  const namedUrl = env(urlRef);
  const namedKey = env(keyRef);
  if (profileId === "general" || !profileId) {
    return { url: env("HERMES_API_URL"), credentialReference: "HERMES_API_KEY" };
  }
  return {
    url: namedUrl,
    credentialReference: namedKey ? keyRef : "HERMES_API_KEY",
  };
}

export function listHermesNamedProfiles(): HermesNamedProfile[] {
  const found = new Map<string, HermesNamedProfile>();
  const defaultUrl = env("HERMES_API_URL");
  found.set("default", {
    id: "default",
    kind: "hermes_profile",
    profilePath: profilePathFromUrl(defaultUrl) || null,
    credentialReference: "HERMES_API_KEY",
    urlConfigured: Boolean(defaultUrl),
    configured: Boolean(defaultUrl && env("HERMES_API_KEY")),
  });

  for (const name of Object.keys(process.env)) {
    const match = name.match(/^HERMES_([A-Z0-9]+)_API_URL$/);
    if (!match || SKIP_ENV.test(match[1])) continue;
    const id = match[1].toLowerCase();
    const url = env(name);
    const keyRef = env(`HERMES_${match[1]}_API_KEY`)
      ? `HERMES_${match[1]}_API_KEY`
      : "HERMES_API_KEY";
    found.set(id, {
      id,
      kind: "hermes_profile",
      profilePath: profilePathFromUrl(url) || null,
      credentialReference: keyRef,
      urlConfigured: Boolean(url),
      configured: Boolean(url && env(keyRef)),
    });
  }
  return Array.from(found.values());
}

function safeUrl(raw: string, key: string) {
  try {
    return normalizeHermesUrl(raw, key);
  } catch (error) {
    if (error instanceof ApiError) return "";
    return "";
  }
}

/**
 * Console role ≠ Hermes named profile.
 * Missing dedicated env falls back to default Hermes when possible.
 * Unknown named profile does not crash; caller receives ok=false.
 */
export function resolveHermesTarget(profileId?: string): HermesTargetResolution {
  const requested = (profileId || "general").trim() || "general";
  const isConsoleRole = CONSOLE_ROLES.has(requested);
  const named = listHermesNamedProfiles().find((item) => item.id === requested);
  const lookup = lookupEnvTarget(isConsoleRole || named ? requested : "general");
  const defaultLookup = lookupEnvTarget("general");
  const defaultKey = readHermesCredential("HERMES_API_KEY");
  const defaultUrl = defaultLookup.url
    ? safeUrl(defaultLookup.url, defaultKey)
    : "";

  if (!isConsoleRole && requested !== "general" && !named) {
    return {
      ok: Boolean(defaultUrl && defaultKey),
      profileId: requested,
      kind: "named",
      baseUrl: defaultUrl,
      profilePath: profilePathFromUrl(defaultUrl),
      credentialReference: "HERMES_API_KEY",
      configured: false,
      fallbackUsed: Boolean(defaultUrl && defaultKey),
      error: `Named Hermes profile "${requested}" is not configured.`,
    };
  }

  const kind: HermesTargetKind = isConsoleRole
    ? requested === "general"
      ? "default"
      : "console_role"
    : requested === "general" || requested === "default"
      ? "default"
      : "named";

  const key = readHermesCredential(lookup.credentialReference) || defaultKey;
  const url = lookup.url ? safeUrl(lookup.url, key) : "";
  if (url && key) {
    return {
      ok: true,
      profileId: requested,
      kind,
      baseUrl: url,
      profilePath: profilePathFromUrl(url) || profilePathFromUrl(lookup.url),
      credentialReference: lookup.credentialReference,
      configured: true,
      fallbackUsed: false,
    };
  }

  if (defaultUrl && defaultKey && requested !== "general") {
    return {
      ok: true,
      profileId: requested,
      kind,
      baseUrl: defaultUrl,
      profilePath: profilePathFromUrl(defaultUrl),
      credentialReference: "HERMES_API_KEY",
      configured: false,
      fallbackUsed: true,
      error: `${urlReferenceForProfile(requested)} not set; using default Hermes.`,
    };
  }

  return {
    ok: false,
    profileId: requested,
    kind,
    baseUrl: "",
    profilePath: "",
    credentialReference: lookup.credentialReference,
    configured: false,
    fallbackUsed: false,
    error: defaultUrl
      ? "Hermes credential reference is empty."
      : "Default Hermes URL is not configured.",
  };
}

export function asAgentRole(profileId?: string): AgentRole {
  const id = (profileId || "general").trim();
  if (id === "developer") return "development";
  if (
    id === "general" ||
    id === "creative" ||
    id === "research" ||
    id === "tku" ||
    id === "design" ||
    id === "social" ||
    id === "development" ||
    id === "reviewer"
  ) {
    return id;
  }
  return "general";
}
