/**
 * Public surface of the auth feature. Routes and other features import from
 * here, never from the internal folders.
 */
export { default as SignInForm } from "./components/SignInForm";
export { default as ForgotPasswordForm } from "./components/ForgotPasswordForm";
export { default as VerifyOtpForm } from "./components/VerifyOtpForm";
export { default as ResetPasswordForm } from "./components/ResetPasswordForm";
export { default as ChangePasswordForm } from "./components/ChangePasswordForm";
export { default as ActiveSessionsList } from "./components/ActiveSessionsList";

export { signInAction, type SignInState } from "./actions/sign-in.action";
export { signOutAction } from "./actions/sign-out.action";
export {
  forgotPasswordAction,
  type ForgotPasswordState,
} from "./actions/forgot-password.action";
export {
  verifyOtpAction,
  type VerifyOtpState,
} from "./actions/verify-otp.action";
export {
  resetPasswordAction,
  type ResetPasswordState,
} from "./actions/reset-password.action";
export {
  changePasswordAction,
  type ChangePasswordState,
} from "./actions/change-password.action";

export {
  revokeSessionAction,
  type RevokeSessionState,
} from "./actions/revoke-session.action";
export { revokeAllSessionsAction } from "./actions/revoke-all-sessions.action";

export { getSession, requireSession, RESET_TOKEN_COOKIE } from "./api/session";
export { fetchActiveSessions, type SessionsResult } from "./api/sessions";
export { dashboardPathFor } from "./utils/dashboard-path";
export { signInSchema, type SignInInput } from "./schemas/sign-in.schema";
export {
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type VerifyOtpInput,
  type ResetPasswordInput,
} from "./schemas/recovery.schema";
export {
  changePasswordSchema,
  type ChangePasswordInput,
} from "./schemas/change-password.schema";
