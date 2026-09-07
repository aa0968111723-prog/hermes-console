export type ToolPermissionClass =
  | "read"
  | "draft"
  | "write"
  | "publish"
  | "destructive";

const rules: Array<{ class: ToolPermissionClass; pattern: RegExp }> = [
  { class: "publish", pattern: /publish|post_instagram|ig_publish|schedule_post/i },
  { class: "destructive", pattern: /delete|purge|destroy|drop|revoke|wipe/i },
  {
    class: "write",
    pattern:
      /canva_(create|upload|export|autofill)|external_(write|update)|patch_|put_/i,
  },
  {
    class: "draft",
    pattern:
      /save_(direction|copy|activity|reference|inspiration)|workspace_save|draft/i,
  },
];

export function permissionClass(toolName: string): ToolPermissionClass {
  for (const rule of rules) if (rule.pattern.test(toolName)) return rule.class;
  return "read";
}

export function autoAllowed(toolName: string) {
  const cls = permissionClass(toolName);
  return cls === "read" || cls === "draft";
}

export function confirmationRequired(toolName: string) {
  const cls = permissionClass(toolName);
  return cls === "publish" || cls === "destructive" || cls === "write";
}

export function permissionPolicy() {
  return {
    read: "auto",
    draft: "auto",
    write: "confirm_when_meaningful",
    publish: "always_confirm",
    destructive: "always_confirm",
  } as const;
}
