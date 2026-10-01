import { PrismaClient } from "@prisma/client";
import { secureMysqlUrl } from "../apps/api/src/config.js";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });

const permissions = [
  ["profile.read", "Read own profile"],
  ["branch.read", "Read an assigned branch catalog"],
  ["request.submit", "Create and submit own-branch requests"],
  ["request.manager.review", "Review manager-assigned requests"],
  ["request.review", "Read and review branch-scoped pending requests"],
  ["request.approve", "Approve branch-scoped pending requests"],
  ["request.return", "Return branch-scoped pending requests"],
  ["request.reject", "Reject branch-scoped pending requests"],
  ["warehouse.process", "Process warehouse requests"],
  ["admin.manage", "Manage system administration resources"],
  ["reports.view", "View authorized operational reports"],
  ["reports.export", "Export authorized operational reports"],
] as const;

const rolePermissions: Record<string, string[]> = {
  system_admin: permissions.map(([code]) => code),
  branch_employee: ["profile.read", "branch.read", "request.submit"],
  branch_manager: ["profile.read", "branch.read", "request.manager.review", "request.review", "request.approve", "request.return", "request.reject", "reports.view", "reports.export"],
  warehouse_manager: ["profile.read", "branch.read", "warehouse.process", "reports.view", "reports.export"],
};

const roles = [
  ["system_admin", "System Admin"],
  ["branch_employee", "Branch Employee"],
  ["branch_manager", "Restaurant / Branch Manager"],
  ["warehouse_manager", "Warehouse Manager"],
] as const;

async function main() {
  for (const [code, name] of permissions) {
    await prisma.permission.upsert({ where: { code }, update: { name }, create: { code, name } });
  }
  for (const [code, name] of roles) {
    const role = await prisma.role.upsert({ where: { code }, update: { name }, create: { code, name } });
    for (const permissionCode of rolePermissions[code]) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permissionCode } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
  console.log(JSON.stringify({ event: "system_roles_seeded", roles: roles.length, permissions: permissions.length }));
}

main().finally(() => prisma.$disconnect());
