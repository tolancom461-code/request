export const SYSTEM_ROLES = [
  "system_admin",
  "branch_employee",
  "branch_manager",
  "warehouse_manager",
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[number];

export const ACTOR_TYPES = ["user", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const REQUEST_STATUSES = [
  "draft",
  "pending_approval",
  "returned",
  "rejected",
  "approved",
  "sent_to_warehouse",
  "preparing",
  "ready",
  "dispatched",
  "completed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
