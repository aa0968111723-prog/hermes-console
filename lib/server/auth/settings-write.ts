import { authenticate } from "../security";
import { isAuthRequired } from "./mode";
import { requireAccess, requireRole } from "./session";

export function requireSettingsWrite(request: Request) {
  authenticate(request, true);
  if (isAuthRequired()) {
    requireRole(requireAccess(request).membership, ["owner", "admin"]);
  }
}
