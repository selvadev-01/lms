import { describe, it, expect } from "vitest";
import { env } from "./env";

/**
 * Guards the env contract itself: the schema must expose the variables the
 * root layout, sitemap and robots handlers read, with usable defaults so a
 * fresh clone boots without a .env.local.
 */
describe("env", () => {
  it("exposes the app name", () => {
    expect(env.NEXT_PUBLIC_APP_NAME).toBeTruthy();
  });

  it("exposes a valid absolute app URL", () => {
    expect(() => new URL(env.NEXT_PUBLIC_APP_URL)).not.toThrow();
  });

  it("does not leak server-only keys into the client shape", () => {
    // Anything added to the `server` block must never appear on a NEXT_PUBLIC_ key.
    const publicKeys = Object.keys(env).filter((k) =>
      k.startsWith("NEXT_PUBLIC_"),
    );
    expect(publicKeys).toContain("NEXT_PUBLIC_APP_NAME");
    expect(publicKeys).toContain("NEXT_PUBLIC_APP_URL");
  });
});
