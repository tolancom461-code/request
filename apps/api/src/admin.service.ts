import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, Prisma, RecordStatus } from "@prisma/client";
import argon2 from "argon2";
import { PrismaService } from "./prisma.service.js";
import { PrimarySupplierTemporalService } from "./primary-supplier-temporal.service.js";

export type ListQuery = {
  page: number;
  pageSize: number;
  search?: string;
  status?: RecordStatus;
  sortBy: string;
  sortDir: "asc" | "desc";
};

type StatusInput = { status: RecordStatus };
type BranchInput = { code: string; nameAr: string; nameEn: string };
type SupplierInput = { supplierCode: string; supplierName: string; taxNumber?: string | null };
type UnitInput = { code: string; nameAr: string; nameEn?: string | null };
type CategoryInput = { code: string; nameAr: string; nameEn?: string | null };
type UserInput = { username: string; email?: string | null; status?: RecordStatus };
type RoleInput = { code: string; name: string; description?: string | null };

const txOptions = { maxWait: 10_000, timeout: 60_000 };
const builtInRoleCodes = new Set(["system_admin", "branch_employee", "branch_manager", "warehouse_manager"]);

const toUser = (user: { id: string; username: string; email: string | null; status: RecordStatus; deletedAt: Date | null; createdAt: Date; updatedAt: Date }) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  status: user.status,
  deletedAt: user.deletedAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PrimarySupplierTemporalService) private readonly primaries: PrimarySupplierTemporalService) {}

  private pagination<T>(query: ListQuery, total: number, items: T[]) {
    return { items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  private duplicate(error: unknown, label: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException(`${label} must be unique.`);
    throw error;
  }

  private async audit(tx: Prisma.TransactionClient, actorUserId: string, entityType: string, entityId: string, action: string, beforeData?: Prisma.InputJsonValue, afterData?: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { actorType: ActorType.user, actorUserId, entityType, entityId, action, beforeData, afterData } });
  }

  private normalizeList(ids: string[], label: string) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new BadRequestException(`${label} cannot contain duplicates.`);
    return unique;
  }

  private async getUserForAdmin(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, email: true, status: true, deletedAt: true, createdAt: true, updatedAt: true,
        roles: { select: { role: { select: { id: true, code: true, name: true } } } },
        branchScopes: { select: { branch: { select: { id: true, code: true, nameAr: true, nameEn: true, status: true } } } },
      },
    });
    if (!user) throw new NotFoundException("User was not found.");
    return user;
  }

  private async assertSystemAdminRemains(tx: Prisma.TransactionClient, targetIsSystemAdmin: boolean, targetWillRemainSystemAdmin: boolean, targetWillRemainActive: boolean) {
    if (!targetIsSystemAdmin || (targetWillRemainSystemAdmin && targetWillRemainActive)) return;
    const activeSystemAdmins = await tx.user.count({ where: { status: RecordStatus.active, roles: { some: { role: { code: "system_admin" } } } } });
    if (activeSystemAdmins <= 1) throw new ConflictException("The last active System Admin cannot be removed or deactivated.");
  }

  async listBranches(query: ListQuery) {
    const where: Prisma.BranchWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: [{ code: { contains: query.search } }, { nameAr: { contains: query.search } }, { nameEn: { contains: query.search } }] } : {}),
    };
    const sortable = new Set(["code", "nameAr", "nameEn", "status", "createdAt", "updatedAt"]);
    const sortBy = sortable.has(query.sortBy) ? query.sortBy : "code";
    const [total, items] = await this.prisma.$transaction([
      this.prisma.branch.count({ where }),
      this.prisma.branch.findMany({ where, orderBy: { [sortBy]: query.sortDir }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return this.pagination(query, total, items);
  }

  async getBranch(id: string) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException("Branch was not found.");
    return branch;
  }

  async createBranch(input: BranchInput, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const branch = await tx.branch.create({ data: input });
        await this.audit(tx, actorUserId, "branch", branch.id, "created", undefined, { code: branch.code, nameAr: branch.nameAr, nameEn: branch.nameEn, status: branch.status });
        return branch;
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Branch code"); }
  }

  async updateBranch(id: string, input: Partial<BranchInput>, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.branch.findUnique({ where: { id } });
        if (!before) throw new NotFoundException("Branch was not found.");
        const branch = await tx.branch.update({ where: { id }, data: input });
        await this.audit(tx, actorUserId, "branch", id, "updated", { code: before.code, nameAr: before.nameAr, nameEn: before.nameEn, status: before.status }, { code: branch.code, nameAr: branch.nameAr, nameEn: branch.nameEn, status: branch.status });
        return branch;
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Branch code"); }
  }

  async setBranchStatus(id: string, input: StatusInput, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw new NotFoundException("Branch was not found.");
      const branch = await tx.branch.update({ where: { id }, data: input });
      await this.audit(tx, actorUserId, "branch", id, input.status === RecordStatus.active ? "activated" : "deactivated", { status: before.status }, { status: branch.status });
      return branch;
    }, txOptions);
  }

  async listSuppliers(query: ListQuery) {
    const where: Prisma.SupplierWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: [{ supplierCode: { contains: query.search } }, { supplierName: { contains: query.search } }, { taxNumber: { contains: query.search } }] } : {}),
    };
    const sortable = new Set(["supplierCode", "supplierName", "taxNumber", "status"]);
    const sortBy = sortable.has(query.sortBy) ? query.sortBy : "supplierCode";
    const [total, items] = await this.prisma.$transaction([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({ where, orderBy: { [sortBy]: query.sortDir }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return this.pagination(query, total, items);
  }

  async getSupplier(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException("Supplier was not found.");
    return supplier;
  }

  async createSupplier(input: SupplierInput, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({ data: { ...input, taxNumber: input.taxNumber ?? null } });
        await this.audit(tx, actorUserId, "supplier", supplier.id, "created", undefined, { supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, taxNumber: supplier.taxNumber, status: supplier.status });
        return supplier;
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Supplier code or tax number"); }
  }

  async updateSupplier(id: string, input: Partial<SupplierInput>, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.supplier.findUnique({ where: { id } });
        if (!before) throw new NotFoundException("Supplier was not found.");
        const supplier = await tx.supplier.update({ where: { id }, data: input });
        await this.audit(tx, actorUserId, "supplier", id, "updated", { supplierCode: before.supplierCode, supplierName: before.supplierName, taxNumber: before.taxNumber, status: before.status }, { supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, taxNumber: supplier.taxNumber, status: supplier.status });
        return supplier;
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Supplier code or tax number"); }
  }

  async setSupplierStatus(id: string, input: StatusInput, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supplier.findUnique({ where: { id } });
      if (!before) throw new NotFoundException("Supplier was not found.");
      const supplier = await tx.supplier.update({ where: { id }, data: { status: input.status, deletedAt: input.status === RecordStatus.inactive ? new Date() : null } });
      const relations = await tx.branchItemSupplier.findMany({ where: { supplierId: id }, select: { branchItemId: true } });
      for (const branchItemId of new Set(relations.map((relation) => relation.branchItemId))) await this.primaries.reconcileGuard(tx, branchItemId);
      await this.audit(tx, actorUserId, "supplier", id, input.status === RecordStatus.active ? "restored" : "deactivated", { status: before.status, deletedAt: before.deletedAt?.toISOString() ?? null }, { status: supplier.status, deletedAt: supplier.deletedAt?.toISOString() ?? null });
      return supplier;
    }, txOptions);
  }

  async listUnits(query: ListQuery) {
    const where: Prisma.UnitWhereInput = { ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ code: { contains: query.search } }, { nameAr: { contains: query.search } }, { nameEn: { contains: query.search } }] } : {}) };
    const sortable = new Set(["code", "nameAr", "nameEn", "status"]);
    const sortBy = sortable.has(query.sortBy) ? query.sortBy : "code";
    const [total, items] = await this.prisma.$transaction([this.prisma.unit.count({ where }), this.prisma.unit.findMany({ where, orderBy: { [sortBy]: query.sortDir }, skip: (query.page - 1) * query.pageSize, take: query.pageSize })]);
    return this.pagination(query, total, items);
  }

  async getUnit(id: string) { const unit = await this.prisma.unit.findUnique({ where: { id } }); if (!unit) throw new NotFoundException("Unit was not found."); return unit; }

  async createUnit(input: UnitInput, actorUserId: string) {
    try { return await this.prisma.$transaction(async (tx) => { const unit = await tx.unit.create({ data: { ...input, nameEn: input.nameEn ?? null } }); await this.audit(tx, actorUserId, "unit", unit.id, "created", undefined, { code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn, status: unit.status }); return unit; }, txOptions); } catch (error) { return this.duplicate(error, "Unit code"); }
  }

  async updateUnit(id: string, input: Partial<UnitInput>, actorUserId: string) {
    try { return await this.prisma.$transaction(async (tx) => { const before = await tx.unit.findUnique({ where: { id } }); if (!before) throw new NotFoundException("Unit was not found."); const unit = await tx.unit.update({ where: { id }, data: input }); await this.audit(tx, actorUserId, "unit", id, "updated", { code: before.code, nameAr: before.nameAr, nameEn: before.nameEn, status: before.status }, { code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn, status: unit.status }); return unit; }, txOptions); } catch (error) { return this.duplicate(error, "Unit code"); }
  }

  async setUnitStatus(id: string, input: StatusInput, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => { const before = await tx.unit.findUnique({ where: { id } }); if (!before) throw new NotFoundException("Unit was not found."); const unit = await tx.unit.update({ where: { id }, data: input }); await this.audit(tx, actorUserId, "unit", id, input.status === RecordStatus.active ? "activated" : "deactivated", { status: before.status }, { status: unit.status }); return unit; }, txOptions);
  }

  async listCategories(query: ListQuery) {
    const where: Prisma.CategoryWhereInput = { ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ code: { contains: query.search } }, { nameAr: { contains: query.search } }, { nameEn: { contains: query.search } }] } : {}) };
    const sortable = new Set(["code", "nameAr", "nameEn", "status"]);
    const sortBy = sortable.has(query.sortBy) ? query.sortBy : "code";
    const [total, items] = await this.prisma.$transaction([this.prisma.category.count({ where }), this.prisma.category.findMany({ where, orderBy: { [sortBy]: query.sortDir }, skip: (query.page - 1) * query.pageSize, take: query.pageSize })]);
    return this.pagination(query, total, items);
  }

  async getCategory(id: string) { const category = await this.prisma.category.findUnique({ where: { id } }); if (!category) throw new NotFoundException("Category was not found."); return category; }

  async createCategory(input: CategoryInput, actorUserId: string) {
    try { return await this.prisma.$transaction(async (tx) => { const category = await tx.category.create({ data: { ...input, nameEn: input.nameEn ?? null } }); await this.audit(tx, actorUserId, "category", category.id, "created", undefined, { code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, status: category.status }); return category; }, txOptions); } catch (error) { return this.duplicate(error, "Category code"); }
  }

  async updateCategory(id: string, input: Partial<CategoryInput>, actorUserId: string) {
    try { return await this.prisma.$transaction(async (tx) => { const before = await tx.category.findUnique({ where: { id } }); if (!before) throw new NotFoundException("Category was not found."); const category = await tx.category.update({ where: { id }, data: input }); await this.audit(tx, actorUserId, "category", id, "updated", { code: before.code, nameAr: before.nameAr, nameEn: before.nameEn, status: before.status }, { code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, status: category.status }); return category; }, txOptions); } catch (error) { return this.duplicate(error, "Category code"); }
  }

  async setCategoryStatus(id: string, input: StatusInput, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => { const before = await tx.category.findUnique({ where: { id } }); if (!before) throw new NotFoundException("Category was not found."); const category = await tx.category.update({ where: { id }, data: { status: input.status, deletedAt: input.status === RecordStatus.inactive ? new Date() : null } }); await this.audit(tx, actorUserId, "category", id, input.status === RecordStatus.active ? "restored" : "deactivated", { status: before.status, deletedAt: before.deletedAt?.toISOString() ?? null }, { status: category.status, deletedAt: category.deletedAt?.toISOString() ?? null }); return category; }, txOptions);
  }

  async listUsers(query: ListQuery) {
    const where: Prisma.UserWhereInput = { ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ username: { contains: query.search } }, { email: { contains: query.search } }] } : {}) };
    const sortable = new Set(["username", "email", "status", "createdAt", "updatedAt"]);
    const sortBy = sortable.has(query.sortBy) ? query.sortBy : "username";
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { [sortBy]: query.sortDir }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, username: true, email: true, status: true, deletedAt: true, createdAt: true, updatedAt: true, roles: { select: { role: { select: { code: true, name: true } } } } } }),
    ]);
    return this.pagination(query, total, users.map((user) => ({ ...toUser(user), roles: user.roles.map((entry) => entry.role) })));
  }

  async getUser(id: string) { return this.getUserForAdmin(this.prisma, id); }

  async createUser(input: UserInput & { password: string; roleIds: string[]; branchIds: string[] }, actorUserId: string) {
    const roleIds = this.normalizeList(input.roleIds, "Role assignments");
    const branchIds = this.normalizeList(input.branchIds, "Branch scopes");
    if (roleIds.length === 0) throw new BadRequestException("At least one role is required.");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [roles, branches] = await Promise.all([
          tx.role.findMany({ where: { id: { in: roleIds } } }),
          tx.branch.findMany({ where: { id: { in: branchIds }, status: RecordStatus.active } }),
        ]);
        if (roles.length !== roleIds.length) throw new BadRequestException("One or more roles do not exist.");
        if (branches.length !== branchIds.length) throw new BadRequestException("One or more branch scopes do not exist or are inactive.");
        const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
        const user = await tx.user.create({ data: { username: input.username, email: input.email ?? null, passwordHash, status: input.status ?? RecordStatus.active, roles: { create: roleIds.map((roleId) => ({ roleId })) }, branchScopes: { create: branchIds.map((branchId) => ({ branchId })) } } });
        await this.audit(tx, actorUserId, "user", user.id, "created", undefined, { username: user.username, email: user.email, status: user.status, roleIds, branchIds });
        return toUser(user);
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Username or email"); }
  }

  async updateUser(id: string, input: Partial<UserInput>, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await this.getUserForAdmin(tx, id);
        const nextStatus = input.status ?? before.status;
        if (id === actorUserId && nextStatus !== RecordStatus.active) throw new ForbiddenException("You cannot deactivate your own administrative account.");
        const isSystemAdmin = before.roles.some((entry) => entry.role.code === "system_admin");
        await this.assertSystemAdminRemains(tx, isSystemAdmin, isSystemAdmin, nextStatus === RecordStatus.active);
        const user = await tx.user.update({ where: { id }, data: input });
        await this.audit(tx, actorUserId, "user", id, nextStatus === RecordStatus.active ? "updated" : "deactivated", { username: before.username, email: before.email, status: before.status }, { username: user.username, email: user.email, status: user.status });
        return toUser(user);
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Username or email"); }
  }

  async resetUserPassword(id: string, password: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException("User was not found.");
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await this.audit(tx, actorUserId, "user", id, "password_reset", undefined, { passwordReset: true });
      return { success: true };
    }, txOptions);
  }

  async replaceUserRoles(id: string, roleIdsInput: string[], actorUserId: string) {
    const roleIds = this.normalizeList(roleIdsInput, "Role assignments");
    if (roleIds.length === 0) throw new BadRequestException("At least one role is required.");
    return this.prisma.$transaction(async (tx) => {
      const before = await this.getUserForAdmin(tx, id);
      const roles = await tx.role.findMany({ where: { id: { in: roleIds } } });
      if (roles.length !== roleIds.length) throw new BadRequestException("One or more roles do not exist.");
      const nextHasSystemAdmin = roles.some((role) => role.code === "system_admin");
      if (id === actorUserId && !nextHasSystemAdmin && before.roles.some((entry) => entry.role.code === "system_admin")) throw new ForbiddenException("You cannot remove your own System Admin role.");
      await this.assertSystemAdminRemains(tx, before.roles.some((entry) => entry.role.code === "system_admin"), nextHasSystemAdmin, before.status === RecordStatus.active);
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      await this.audit(tx, actorUserId, "user", id, "roles_replaced", { roleIds: before.roles.map((entry) => entry.role.id) }, { roleIds });
      return this.getUserForAdmin(tx, id);
    }, txOptions);
  }

  async replaceUserScopes(id: string, branchIdsInput: string[], actorUserId: string) {
    const branchIds = this.normalizeList(branchIdsInput, "Branch scopes");
    return this.prisma.$transaction(async (tx) => {
      const before = await this.getUserForAdmin(tx, id);
      const branches = await tx.branch.findMany({ where: { id: { in: branchIds }, status: RecordStatus.active } });
      if (branches.length !== branchIds.length) throw new BadRequestException("One or more branch scopes do not exist or are inactive.");
      await tx.userBranchScope.deleteMany({ where: { userId: id } });
      if (branchIds.length) await tx.userBranchScope.createMany({ data: branchIds.map((branchId) => ({ userId: id, branchId })) });
      await this.audit(tx, actorUserId, "user", id, "branch_scopes_replaced", { branchIds: before.branchScopes.map((entry) => entry.branch.id) }, { branchIds });
      return this.getUserForAdmin(tx, id);
    }, txOptions);
  }

  async listRoles() {
    return this.prisma.role.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, description: true, _count: { select: { userRoles: true, permissions: true } } } });
  }

  private async roleDetails(client: Pick<Prisma.TransactionClient, "role">, id: string) {
    const role = await client.role.findUnique({ where: { id }, select: { id: true, code: true, name: true, description: true, permissions: { select: { permission: { select: { id: true, code: true, name: true, description: true } } } }, userRoles: { select: { user: { select: { id: true, username: true, email: true, status: true } } } } } });
    if (!role) throw new NotFoundException("Role was not found.");
    return { ...role, permissions: role.permissions.map((entry) => entry.permission), users: role.userRoles.map((entry) => entry.user) };
  }

  async getRole(id: string) { return this.roleDetails(this.prisma, id); }

  async createRole(input: RoleInput, actorUserId: string) {
    if (builtInRoleCodes.has(input.code)) throw new ConflictException("Built-in role codes are reserved.");
    try {
      return await this.prisma.$transaction(async (tx) => { const role = await tx.role.create({ data: input }); await this.audit(tx, actorUserId, "role", role.id, "created", undefined, { code: role.code, name: role.name, description: role.description }); return role; }, txOptions);
    } catch (error) { return this.duplicate(error, "Role code"); }
  }

  async updateRole(id: string, input: Pick<RoleInput, "name" | "description">, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.role.findUnique({ where: { id } });
      if (!before) throw new NotFoundException("Role was not found.");
      if (builtInRoleCodes.has(before.code)) throw new ForbiddenException("Built-in roles cannot be edited from administration.");
      const role = await tx.role.update({ where: { id }, data: input });
      await this.audit(tx, actorUserId, "role", id, "updated", { name: before.name, description: before.description }, { name: role.name, description: role.description });
      return role;
    }, txOptions);
  }

  async listPermissions() { return this.prisma.permission.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, description: true } }); }

  async replaceRolePermissions(id: string, permissionIdsInput: string[], actorUserId: string) {
    const permissionIds = this.normalizeList(permissionIdsInput, "Permission assignments");
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { permissions: true } });
      if (!role) throw new NotFoundException("Role was not found.");
      const permissions = await tx.permission.findMany({ where: { id: { in: permissionIds } } });
      if (permissions.length !== permissionIds.length) throw new BadRequestException("One or more permissions do not exist.");
      if (role.code === "system_admin" && !permissions.some((permission) => permission.code === "admin.manage")) throw new ConflictException("system_admin must retain admin.manage.");
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissionIds.length) await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) });
      await this.audit(tx, actorUserId, "role", id, "permissions_replaced", { permissionIds: role.permissions.map((entry) => entry.permissionId) }, { permissionIds });
      return this.roleDetails(tx, id);
    }, txOptions);
  }
}
