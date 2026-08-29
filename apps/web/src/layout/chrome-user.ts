/**
 * The slice of the session the app chrome displays.
 *
 * Deliberately narrower than `AuthUser`: everything a server component hands to
 * a client component is serialized into the RSC payload the browser receives,
 * and the header needs a name and a way to reach the user — not the permission
 * list, the org id, or the branch id.
 *
 * `null` where there is no session. The admin layout does not redirect on a
 * missing one (each page runs its own guard), so the chrome has to render
 * without it rather than assume it is there.
 */
export type ChromeUser = {
  name: string;
  mobile: string;
  /** `User.email` is nullable — sign-in is by mobile. */
  email?: string;
  orgCode: string;
};
