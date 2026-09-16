export const MEMBERSHIP_LABELS = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員",
} as const;

export function membershipLabel(role: string | null | undefined) {
  if (role === "owner" || role === "admin" || role === "member")
    return MEMBERSHIP_LABELS[role];
  return "尚未加入";
}
