import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { RecordStatus } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AdminService, type ListQuery } from "./admin.service.js";
import { Permissions, PermissionsGuard } from "./security.js";
import type { SessionRecord } from "./session.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
const recordStatus = z.nativeEnum(RecordStatus);
const idSchema = z.string().uuid();
const collectionQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
  status: recordStatus.optional(),
  sortBy: z.string().trim().min(1).max(40).default("code"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});
const statusSchema = z.object({ status: recordStatus });
const nonEmptyPatch = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial().refine((value) => Object.keys(value).length > 0, "At least one field is required.");
const branchSchema = z.object({ code: z.string().trim().min(1).max(50), nameAr: z.string().trim().min(1).max(200), nameEn: z.string().trim().min(1).max(200) });
const supplierSchema = z.object({ supplierCode: z.string().trim().min(1).max(80), supplierName: z.string().trim().min(1).max(200), taxNumber: z.string().trim().min(1).max(100).nullable().optional() });
const unitSchema = z.object({ code: z.string().trim().min(1).max(40), nameAr: z.string().trim().min(1).max(100), nameEn: z.string().trim().min(1).max(100).nullable().optional() });
const categorySchema = z.object({ code: z.string().trim().min(1).max(50), nameAr: z.string().trim().min(1).max(200), nameEn: z.string().trim().min(1).max(200).nullable().optional() });
const optionalEmail = z.preprocess((value) => value === "" ? null : value, z.string().trim().email().max(320).nullable().optional());
const userSchema = z.object({ username: z.string().trim().min(3).max(100), email: optionalEmail, status: recordStatus.optional() });
const createUserSchema = userSchema.extend({ password: z.string().min(12).max(256), roleIds: z.array(idSchema).min(1).max(20), branchIds: z.array(idSchema).max(500) });
const roleSchema = z.object({ code: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,99}$/), name: z.string().trim().min(1).max(150), description: z.string().trim().max(500).nullable().optional() });
const roleUpdateSchema = z.object({ name: z.string().trim().min(1).max(150), description: z.string().trim().max(500).nullable().optional() });
const idsSchema = z.object({ ids: z.array(idSchema).max(500) });
const passwordSchema = z.object({ password: z.string().min(12).max(256) });

@Controller("admin")
@UseGuards(PermissionsGuard)
@Permissions("admin.manage")
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  private actor(request: RequestWithSession) { return request.restaurantSession!.userId; }
  private id(raw: string) { return idSchema.parse(raw); }
  private query(raw: unknown): ListQuery { return collectionQuery.parse(raw); }

  @Get("branches") branches(@Query() query: unknown) { return this.admin.listBranches(this.query(query)); }
  @Post("branches") createBranch(@Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.createBranch(branchSchema.parse(body), this.actor(request)); }
  @Get("branches/:id") branch(@Param("id") id: string) { return this.admin.getBranch(this.id(id)); }
  @Patch("branches/:id") updateBranch(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.updateBranch(this.id(id), nonEmptyPatch(branchSchema.shape).parse(body), this.actor(request)); }
  @Post("branches/:id/status") branchStatus(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.setBranchStatus(this.id(id), statusSchema.parse(body), this.actor(request)); }

  @Get("suppliers") suppliers(@Query() query: unknown) { return this.admin.listSuppliers(this.query(query)); }
  @Post("suppliers") createSupplier(@Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.createSupplier(supplierSchema.parse(body), this.actor(request)); }
  @Get("suppliers/:id") supplier(@Param("id") id: string) { return this.admin.getSupplier(this.id(id)); }
  @Patch("suppliers/:id") updateSupplier(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.updateSupplier(this.id(id), nonEmptyPatch(supplierSchema.shape).parse(body), this.actor(request)); }
  @Post("suppliers/:id/status") supplierStatus(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.setSupplierStatus(this.id(id), statusSchema.parse(body), this.actor(request)); }

  @Get("units") units(@Query() query: unknown) { return this.admin.listUnits(this.query(query)); }
  @Post("units") createUnit(@Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.createUnit(unitSchema.parse(body), this.actor(request)); }
  @Get("units/:id") unit(@Param("id") id: string) { return this.admin.getUnit(this.id(id)); }
  @Patch("units/:id") updateUnit(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.updateUnit(this.id(id), nonEmptyPatch(unitSchema.shape).parse(body), this.actor(request)); }
  @Post("units/:id/status") unitStatus(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.setUnitStatus(this.id(id), statusSchema.parse(body), this.actor(request)); }

  @Get("categories") categories(@Query() query: unknown) { return this.admin.listCategories(this.query(query)); }
  @Post("categories") createCategory(@Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.createCategory(categorySchema.parse(body), this.actor(request)); }
  @Get("categories/:id") category(@Param("id") id: string) { return this.admin.getCategory(this.id(id)); }
  @Patch("categories/:id") updateCategory(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.updateCategory(this.id(id), nonEmptyPatch(categorySchema.shape).parse(body), this.actor(request)); }
  @Post("categories/:id/status") categoryStatus(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.setCategoryStatus(this.id(id), statusSchema.parse(body), this.actor(request)); }

  @Get("users") users(@Query() query: unknown) { return this.admin.listUsers(this.query(query)); }
  @Post("users") createUser(@Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.createUser(createUserSchema.parse(body), this.actor(request)); }
  @Get("users/:id") user(@Param("id") id: string) { return this.admin.getUser(this.id(id)); }
  @Patch("users/:id") updateUser(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.updateUser(this.id(id), nonEmptyPatch(userSchema.shape).parse(body), this.actor(request)); }
  @Post("users/:id/password") password(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.resetUserPassword(this.id(id), passwordSchema.parse(body).password, this.actor(request)); }
  @Post("users/:id/roles") rolesForUser(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.replaceUserRoles(this.id(id), idsSchema.parse(body).ids, this.actor(request)); }
  @Post("users/:id/branch-scopes") scopesForUser(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.replaceUserScopes(this.id(id), idsSchema.parse(body).ids, this.actor(request)); }

  @Get("roles") roles() { return this.admin.listRoles(); }
  @Post("roles") createRole(@Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.createRole(roleSchema.parse(body), this.actor(request)); }
  @Get("roles/:id") role(@Param("id") id: string) { return this.admin.getRole(this.id(id)); }
  @Patch("roles/:id") updateRole(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.updateRole(this.id(id), roleUpdateSchema.parse(body), this.actor(request)); }
  @Post("roles/:id/permissions") permissionsForRole(@Param("id") id: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.admin.replaceRolePermissions(this.id(id), idsSchema.parse(body).ids, this.actor(request)); }
  @Get("permissions") permissions() { return this.admin.listPermissions(); }
}
