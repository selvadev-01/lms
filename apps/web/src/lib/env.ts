import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Validated environment access. Import this instead of reading process.env
 * directly — a missing or malformed variable fails the build, not production.
 *
 * Server variables are never bundled into client code; only NEXT_PUBLIC_*
 * values reach the browser.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    /**
     * Base URL of the NestJS API. Server-only: the browser never calls the API
     * directly — auth requests go through Server Actions so the session cookies
     * stay same-site.
     */
    API_BASE_URL: z.string().url().default("http://localhost:3001"),
  },
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("LMS"),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  },
  // Next.js only inlines client vars that appear literally, so they must be
  // destructured explicitly rather than spread from process.env.
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    API_BASE_URL: process.env.API_BASE_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
