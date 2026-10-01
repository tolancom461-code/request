import "reflect-metadata";
import path from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";
import { SessionService } from "./session.service.js";

export async function createApplication() {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), { bufferLogs: true });
  // Fastify plugins share compatible runtime contracts; the casts bridge duplicated Fastify type instances from Nest adapters.
  await app.register(cookie as never);
  await app.register(helmet as never, { contentSecurityPolicy: false });
  await app.register(rateLimit as never, { max: 100, timeWindow: "1 minute" });
  await app.register(multipart as never, { limits: { files: 1, fileSize: 5 * 1024 * 1024, parts: 10 } });
  await app.register(cors as never, {
    origin: (origin: string | undefined, callback: (error: Error | null, allowedOrigin?: boolean | string) => void) => callback(null, !origin || origin === config.PUBLIC_APP_ORIGIN),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  const publicDirectory = path.resolve(process.cwd(), "dist", "public");
  await app.register(fastifyStatic as never, {
    root: publicDirectory,
    prefix: "/",
  });

  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.get(SessionService).connect();
  return app;
}

export async function bootstrap() {
  const config = loadConfig();
  const app = await createApplication();
  await app.listen(config.API_PORT, "0.0.0.0");
  console.log(JSON.stringify({ event: "api_started", version: config.APP_VERSION, port: config.API_PORT }));
}

if (process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js")) {
  bootstrap().catch((error) => {
    console.error(JSON.stringify({ event: "api_boot_failure", error: error instanceof Error ? error.message : "unknown" }));
    process.exit(1);
  });
}
