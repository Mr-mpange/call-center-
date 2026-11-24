export const rolePermissions = [
  { perm: "Take & make calls", admin: true, supervisor: true, agent: true },
  { perm: "Listen / whisper / barge", admin: true, supervisor: true, agent: false },
  { perm: "Edit queues & IVR", admin: true, supervisor: true, agent: false },
  { perm: "View analytics", admin: true, supervisor: true, agent: false },
  { perm: "Export call recordings", admin: true, supervisor: false, agent: false },
  { perm: "Manage users & billing", admin: true, supervisor: false, agent: false },
] as const;
