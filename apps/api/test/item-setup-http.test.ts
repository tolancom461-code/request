import "reflect-metadata";
import { Module, UnauthorizedException } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ItemSetupController } from "../src/item-setup.controller.js";
import { ItemSetupService } from "../src/item-setup.service.js";
import { PrismaService } from "../src/prisma.service.js";
import { SessionService } from "../src/session.service.js";
import { CsrfGuard, SessionGuard } from "../src/security.js";

const itemId = "10000000-0000-4000-8000-000000000001";
const unitId = "10000000-0000-4000-8000-000000000002";
const categoryId = "10000000-0000-4000-8000-000000000003";
const branchId = "10000000-0000-4000-8000-000000000004";
const service = {
  options: vi.fn(),
  items: vi.fn(),
  saveItem: vi.fn(),
  setSupplier: vi.fn(),
  assignRestaurantItems: vi.fn(),
};
const prisma = {
  userRole: {
    findMany: async ({ where }: { where: { userId: string } }) =>
      where.userId === "admin"
        ? [
            {
              role: { permissions: [{ permission: { code: "admin.manage" } }] },
            },
          ]
        : [],
  },
};
const sessions = {
  requestSessionId: (request: { cookies: Record<string, string> }) =>
    request.cookies.session,
  get: async (id?: string) => (id ? { userId: id, csrfToken: "csrf" } : null),
  setCookie: vi.fn(),
  assertCsrf: (_session: unknown, token?: string, origin?: string) => {
    if (token !== "csrf" || origin !== "http://localhost:3000")
      throw new UnauthorizedException();
  },
};
@Module({
  controllers: [ItemSetupController],
  providers: [
    { provide: ItemSetupService, useValue: service },
    { provide: PrismaService, useValue: prisma },
    { provide: SessionService, useValue: sessions },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
class SetupTestModule {}

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(
    SetupTestModule,
    new FastifyAdapter(),
    { logger: false }
  );
  await app.register(cookie as never);
  await app.register(multipart as never, {
    limits: { files: 1, fileSize: 5 * 1024 * 1024, parts: 10 },
  });
  app.setGlobalPrefix("api/v1");
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.items.mockResolvedValue([]);
  service.saveItem.mockResolvedValue({ id: itemId });
});
const headers = {
  cookie: "session=admin",
  origin: "http://localhost:3000",
  "x-csrf-token": "csrf",
};

describe("Protected item setup HTTP routes", () => {
  it("requires authentication, admin permission and CSRF for the new routes", async () => {
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/item-setup/items",
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/item-setup/items",
          headers: { cookie: "session=employee" },
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/admin/item-setup/restaurants/${branchId}/items`,
          headers: { cookie: "session=admin" },
          payload: { itemIds: [], expectedItemIds: [] },
        })
      ).statusCode
    ).toBe(401);
    expect(service.assignRestaurantItems).not.toHaveBeenCalled();
  });

  it("accepts multilingual details and an image in a single multipart save", async () => {
    const data = {
      sku: "RICE",
      nameAr: "أرز",
      nameEn: "Rice",
      nameUr: "چاول",
      categoryId,
      baseUnitId: unitId,
    };
    const boundary = "setup-boundary";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="rice.png"\r\nContent-Type: image/png\r\n\r\npng-image\r\n--${boundary}--\r\n`
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/item-setup/items",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(service.saveItem).toHaveBeenCalledWith(
      "admin",
      { ...data, status: "active" },
      { bytes: Buffer.from("png-image"), contentType: "image/png" },
      undefined
    );
  });

  it("submits an entire restaurant selection and its previous state together", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/item-setup/restaurants/${branchId}/items`,
      headers,
      payload: { itemIds: [itemId], expectedItemIds: [] },
    });
    expect(response.statusCode).toBe(201);
    expect(service.assignRestaurantItems).toHaveBeenCalledWith(
      "admin",
      branchId,
      [itemId],
      []
    );
  });
});
