import { adminNavigation } from "./components/admin-navigation";

export const reportTabs = ["dashboard", "requests", "branches", "items", "suppliers", "status-lifecycle", "approvals", "warehouse"] as const;
export type ReportTab = typeof reportTabs[number];
export const reportTabPath = (tab: ReportTab) => tab === "dashboard" ? "#/reports" : `#/reports/${tab}`;

type WorkspaceView = "dashboard" | "requisitions" | "manager" | "warehouse" | "reports" | "items" | "audit" | "admin";
type WorkspaceRoute = {
  path: string;
  key: string;
  permissions: readonly string[];
  view: WorkspaceView;
  administration?: boolean;
  matches?: (path: string) => boolean;
};

const detailId = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const managerDetail = new RegExp(`^#/manager/requisitions/${detailId}/review$`, "i");
const warehouseDetail = new RegExp(`^#/warehouse/requests/${detailId}$`, "i");
const reportPaths = new Set(reportTabs.map(reportTabPath));

export const workspaceRoutes: readonly WorkspaceRoute[] = [
  { path: "#dashboard", key: "dashboard", permissions: ["reports.view"], view: "dashboard", matches: path => path === "#/dashboard" },
  { path: "#/requisitions", key: "requisitions", permissions: ["branch.read", "request.submit"], view: "requisitions" },
  { path: "#/manager/requisitions", key: "managerInbox", permissions: ["request.review"], view: "manager", matches: path => managerDetail.test(path) },
  { path: "#/warehouse/requests", key: "warehouseQueue", permissions: ["warehouse.process"], view: "warehouse", matches: path => warehouseDetail.test(path) },
  { path: "#/reports", key: "reports", permissions: ["reports.view"], view: "reports", matches: path => reportPaths.has(path) },
  { path: "#/admin/items", key: "items", permissions: ["admin.manage"], view: "items", administration: true },
  { path: "#/admin/audit", key: "auditLog", permissions: ["admin.manage"], view: "audit", administration: true },
  { path: "#/admin/user-activity", key: "userActivity", permissions: ["admin.manage"], view: "audit", administration: true },
  ...adminNavigation.map((route): WorkspaceRoute => ({ ...route, permissions: ["admin.manage"], view: "admin", administration: true })),
];

export function resolveWorkspaceAccess(requestedPath: string, permissions: readonly string[] = []) {
  const allowedRoutes = workspaceRoutes.filter(route => route.permissions.every(permission => permissions.includes(permission)));
  const requestedRoute = allowedRoutes.find(route => route.path === requestedPath || route.matches?.(requestedPath));
  return {
    allowedRoutes,
    activeRoute: requestedRoute ?? allowedRoutes[0],
    path: requestedRoute ? requestedPath : allowedRoutes[0]?.path,
  };
}
