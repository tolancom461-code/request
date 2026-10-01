import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { NotificationService } from "./notification.service.js";
import type { SessionRecord } from "./session.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
const id = z.string().uuid();
const list = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  state: z.enum(["all", "read", "unread"]).default("all"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

@Controller("notifications")
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}
  private user(request: RequestWithSession) { return request.restaurantSession!.userId; }

  @Get()
  list(@Req() request: RequestWithSession, @Query() query: unknown) { return this.notifications.list(this.user(request), list.parse(query)); }

  @Get("unread-count")
  unreadCount(@Req() request: RequestWithSession) { return this.notifications.unreadCount(this.user(request)); }

  @Post(":notificationId/read")
  markRead(@Req() request: RequestWithSession, @Param("notificationId") notificationId: string, @Body() _body: unknown) { return this.notifications.markRead(this.user(request), id.parse(notificationId)); }

  @Post("read-all")
  markAllRead(@Req() request: RequestWithSession, @Body() _body: unknown) { return this.notifications.markAllRead(this.user(request)); }
}
