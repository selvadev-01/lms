import { SignInForm } from "@/features/auth";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
};

/**
 * `orgCode` arrives when signup redirects here after creating an organization.
 * Read on the server and handed to the form as a default, so the client
 * component needs no `useSearchParams` and the route keeps its prerender.
 */
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ orgCode?: string | string[] }>;
}) {
  const { orgCode } = await searchParams;
  const prefill = Array.isArray(orgCode) ? orgCode[0] : orgCode;

  return <SignInForm defaultOrgCode={prefill} />;
}
