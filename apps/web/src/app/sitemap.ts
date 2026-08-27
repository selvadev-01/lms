import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/**
 * Public routes only. Do not list authenticated pages here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.NEXT_PUBLIC_APP_URL;
  const lastModified = new Date();

  return [
    { url: `${base}/signin`, lastModified },
    { url: `${base}/signup`, lastModified },
  ];
}
