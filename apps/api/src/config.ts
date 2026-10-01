import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  APP_VERSION: z.string().default("0.1.0-dev"),
  DATABASE_URL: z.string().url(),
  APP_DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  PUBLIC_APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  PORT: z.coerce.number().int().positive().optional(),
  SESSION_COOKIE_NAME: z.string().default("__Host-session"),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3).optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
});

export type AppConfig = z.infer<typeof environmentSchema> & { sessionSecret: string };

export function loadConfig(environment = process.env): AppConfig {
  const parsed = environmentSchema.parse({
    ...environment,
    DATABASE_URL: environment.APP_DATABASE_URL ?? environment.DATABASE_URL,
  });
  const sessionSecret = parsed.SESSION_SECRET ?? parsed.JWT_SECRET;
  if (!sessionSecret || sessionSecret.length < 24) {
    throw new Error("SESSION_SECRET or JWT_SECRET must contain at least 24 characters for server-side sessions.");
  }
  return { ...parsed, API_PORT: parsed.PORT ?? parsed.API_PORT, sessionSecret };
}

export function secureMysqlUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("ssl");
  parsed.searchParams.set("sslaccept", "strict");
  return parsed.toString();
}
