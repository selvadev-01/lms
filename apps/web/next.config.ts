import type { NextConfig } from "next";

// Importing env here means an invalid environment fails `next build`
// rather than surfacing at runtime in production.
import "./src/lib/env";

/**
 * Baseline security headers.
 *
 * CSP is intentionally absent: a correct policy depends on which analytics,
 * error reporters and embeds you add. Define one before going to production
 * (docs/TEMPLATE-GUIDE.md §3.3) — note that Next requires 'unsafe-inline' for
 * styles, and the theme-init script in the root layout needs a nonce or hash.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    /**
     * Geolocation is enabled for this origin only (`self`), not for embedded
     * third-party frames. The Field Employee GPS check-in needs it; camera and
     * microphone stay fully disabled because nothing uses them.
     *
     * This grants the *page* the capability to ask. The browser still prompts
     * the user, and a refusal is recorded as a failed check-in rather than
     * being worked around.
     */
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build, so Next has
  // to compile them itself.
  transpilePackages: [
    "@lms/ui",
    "@lms/types",
    "@lms/constants",
    "@lms/validation",
  ],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },

  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
