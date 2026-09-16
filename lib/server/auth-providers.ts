import { googleStart, googleCallback } from "./auth-google";
import { tamkangStart, tamkangCallback } from "./auth-tamkang";

export function startGoogleOAuth(_mode: "login" | "link", userId?: string) {
  return googleStart(userId);
}

export async function finishGoogleOAuth(url: URL, _actorId?: string) {
  const result = await googleCallback(url);
  return result.cookie;
}

export async function startTamkangOAuth(
  _mode: "login" | "link",
  userId?: string,
) {
  return tamkangStart(userId);
}

export async function finishTamkangOAuth(url: URL, _actorId?: string) {
  const result = await tamkangCallback(url);
  return result.cookie;
}
