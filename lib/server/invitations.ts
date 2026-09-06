// Dormant optional multi-user helpers. Workspace APIs must not require these.
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, hash, limited, WORKSPACE_OWNER } from "./security";
import { db, get, list, put, transaction } from "./store";
export const emailInput = z.string().trim().email().max(254).transform(s => s.toLowerCase());
export type Member = { id: string; email: string; role: "admin" | "member"; active: boolean; invitedAt: string; delivery: "not_sent" | "accepted" | "failed"; bootstrap?: boolean };
type Link = { id: string; memberId: string; expires: number; used: boolean };
type Session = { id: string; memberId: string; expires: number };
const scope = "access";
const DEFAULT_ADMIN_EMAILS = "aa0968111723@gmail.com";
function bootstrapEmails() {
  return (process.env.CONSOLE_ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS).split(",").map(s => emailInput.safeParse(s)).filter(r => r.success).map(r => r.data!);
}
function bootstrap() {
  const admins = bootstrapEmails();
  for (const member of list<Member>("member", scope))
    if (member.bootstrap && !admins.includes(member.email) && member.active) {
      put("member", scope, { ...member, active: false });
      invalidateMemberAccess(member.id);
    }
  for (const email of admins) {
    const id = hash(email);
    const old = get<Member>("member", scope, id);
    if (!old || !old.active || old.role !== "admin" || !old.bootstrap)
      put("member", scope, { id, email, role: "admin", active: true, bootstrap: true,
        invitedAt: old?.invitedAt || new Date().toISOString(), delivery: old?.delivery || "not_sent" } satisfies Member);
  }
}
export function currentMember(request: Request) {
  bootstrap();
  const token = (request.headers.get("cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith("hermes_invite_session="))?.split("=")[1] || "";
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, "sign_in_required", "請使用獲邀的電子信箱登入。");
  const session = get<Session>("invite_session", scope, hash(token));
  const member = session ? get<Member>("member", scope, session.memberId) : null;
  if (!session || session.expires <= Date.now() || !member?.active)
    throw new ApiError(401, "session_expired", "登入已過期或存取已撤銷，請重新登入。");
  return member;
}
export function requireAdmin(request: Request) {
  const member = currentMember(request);
  if (member.role !== "admin") throw new ApiError(403, "admin_required", "只有管理員可以管理邀請。");
  return member;
}
export function sessionHeader(token = "") {
  return "hermes_invite_session=" + token + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" +
    (token ? "43200" : "0") + (process.env.CONSOLE_ORIGIN?.startsWith("https:") ? "; Secure" : "");
}
export function endSession(request: Request) {
  const token = (request.headers.get("cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith("hermes_invite_session="))?.split("=")[1] || "";
  if (/^[a-f0-9]{64}$/.test(token))
    db().prepare("DELETE FROM records WHERE kind=? AND owner=? AND id=?").run("invite_session", scope, hash(token));
}
function mailConfig() {
  const sender = emailInput.safeParse(process.env.CONSOLE_EMAIL_FROM);
  let origin: URL;
  try { origin = new URL(process.env.CONSOLE_ORIGIN || ""); }
  catch { throw new ApiError(503, "email_unconfigured", "邀請制尚未設定有效的 CONSOLE_ORIGIN。"); }
  if (!sender.success || !process.env.RESEND_API_KEY || !bootstrapEmails().length ||
      origin.username || origin.password ||
      !(origin.protocol === "https:" || (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))))
    throw new ApiError(503, "email_unconfigured", "邀請制尚未設定寄件網域、寄信服務或初始管理員。");
  return { sender: sender.data, origin: origin.origin };
}
async function sendLink(member: Member) {
  const config = mailConfig();
  const token = randomBytes(32).toString("hex");
  const record: Link = { id: hash(token), memberId: member.id, expires: Date.now() + 15 * 60_000, used: false };
  put("login_link", scope, record);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": "console-login-" + randomUUID() },
      body: JSON.stringify({
        from: config.sender, to: [member.email], subject: "Hermes Console 工作區登入邀請",
        text: "你已獲邀使用 Hermes Console。此連結 15 分鐘內有效且只能使用一次。開啟後按確認登入：\n" +
          config.origin + "/#login=" + token + "\n若非你要求，請忽略此信。不要轉寄登入連結。",
      }),
    });
    // Provider acceptance is not inbox delivery. Never return a login token or raw provider error.
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.id !== "string") throw new Error("mail_not_accepted");
    const latest = get<Member>("member", scope, member.id)!;
    put("member", scope, { ...latest, delivery: "accepted" });
  } catch {
    put("login_link", scope, { ...record, used: true });
    const latest = get<Member>("member", scope, member.id)!;
    put("member", scope, { ...latest, delivery: "failed" });
    throw new ApiError(502, "email_failed", "寄信服務未確認接受，請稍後重試；沒有宣稱已送達信箱。");
  }
}
export async function requestLogin(raw: string) {
  const email = emailInput.parse(raw);
  limited("email:global", 30, 15 * 60_000);
  limited("email:" + hash(email), 5, 15 * 60_000);
  mailConfig(); bootstrap();
  const member = get<Member>("member", scope, hash(email));
  if (member?.active) {
    // Public endpoint does not reveal membership or provider failures.
    try { await sendLink(member); } catch {}
  }
  return { message: "若此信箱已獲邀請，系統將嘗試寄出登入連結。未收到時請聯絡管理員；請勿重複大量提交。" };
}
export function redeemLogin(token: string) {
  limited("redeem:global", 60, 15 * 60_000);
  bootstrap();
  return transaction(() => {
    const record = get<Link>("login_link", scope, hash(token));
    const member = record ? get<Member>("member", scope, record.memberId) : null;
    if (!record || record.used || record.expires <= Date.now() || !member?.active)
      throw new ApiError(401, "invalid_link", "登入連結已使用、已過期或邀請已撤銷。");
    put("login_link", scope, { ...record, used: true });
    const session = randomBytes(32).toString("hex");
    put("invite_session", scope, { id: hash(session), memberId: member.id, expires: Date.now() + 12 * 60 * 60_000 } satisfies Session);
    return session;
  });
}
export function members() { bootstrap(); return list<Member>("member", scope); }
export async function invite(raw: string) {
  const email = emailInput.parse(raw);
  limited("invite:global", 20, 60_000);
  mailConfig(); bootstrap();
  const old = get<Member>("member", scope, hash(email));
  const member = put("member", scope, {
    id: hash(email), email, role: bootstrapEmails().includes(email) ? "admin" : "member", active: true,
    bootstrap: bootstrapEmails().includes(email),
    invitedAt: old?.invitedAt || new Date().toISOString(), delivery: "not_sent",
  } satisfies Member);
  await sendLink(member);
  return get<Member>("member", scope, member.id);
}
export function revoke(memberId: string, actor: Member) {
  return transaction(() => {
    const member = get<Member>("member", scope, memberId);
    if (!member) throw new ApiError(404, "member_not_found", "找不到受邀成員。");
    if (member.id === actor.id || member.role === "admin")
      throw new ApiError(409, "admin_protected", "不能在此撤銷管理員；請由部署管理者處理管理員異動。");
    put("member", scope, { ...member, active: false });
    invalidateMemberAccess(memberId);
    return { revoked: true, workspace: WORKSPACE_OWNER };
  });
}
function invalidateMemberAccess(memberId: string) {
  for (const record of list<Session>("invite_session", scope).filter(s => s.memberId === memberId))
    db().prepare("DELETE FROM records WHERE kind=? AND owner=? AND id=?").run("invite_session", scope, record.id);
  for (const record of list<Link>("login_link", scope).filter(s => s.memberId === memberId))
    put("login_link", scope, { ...record, used: true });
}
