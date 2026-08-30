import { SignUpForm } from "@/features/auth";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Organization",
};

export default function SignUp() {
  return <SignUpForm />;
}
