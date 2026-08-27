import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/features/auth";

export const metadata: Metadata = {
  title: "Forgot Password",
};

export default function ForgotPassword() {
  return <ForgotPasswordForm />;
}
