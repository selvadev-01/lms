import Link from "next/link";
import { AvatarText } from "@lms/ui";
import type { AuthUser } from "@lms/types";

/**
 * The signed-in user's own profile.
 *
 * Read-only, and every field comes from the session. It replaced three
 * TailAdmin template cards that displayed a fictional person ("Musharof
 * Chowdhury", an Arizona address, Pimjo social links) beside Edit buttons whose
 * Save handler was `console.log("Saving changes...")` — a form that accepted
 * input and discarded it.
 *
 * What is absent is absent deliberately. The LMS records no address, tax id,
 * bio, social links or avatar for a user, and there is no profile-update
 * endpoint, so a card for any of them could only ever show a placeholder or
 * silently drop what was typed into it. Changing a password is a real action
 * and is linked below; it lives on its own screen because it is a credential
 * change, not a profile edit.
 */

/** One label/value pair. Absent values are rendered, not hidden, so the */
/** reader can tell "not recorded" from "not shown". */
function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="mb-2 text-xs leading-normal text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="text-sm font-medium text-gray-800 dark:text-white/90">
        {value || (
          <span className="text-gray-400 dark:text-gray-500">Not recorded</span>
        )}
      </p>
    </div>
  );
}

export default function ProfileCard({ user }: { user: AuthUser }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 p-5 lg:p-6 dark:border-gray-800">
        <div className="flex flex-col items-center gap-6 xl:flex-row">
          <AvatarText name={user.name} className="h-20! w-20! text-xl!" />

          <div className="text-center xl:text-left">
            <h4 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
              {user.name}
            </h4>
            <div className="flex flex-col items-center gap-1 text-center text-sm text-gray-500 xl:flex-row xl:gap-3 xl:text-left dark:text-gray-400">
              {/* Roles, not a job title: the LMS records what a user may do,
                  and that is the roles assigned to them. A user may hold
                  several. */}
              <p>{user.roles.join(", ") || "No role assigned"}</p>
              {user.branchName && (
                <>
                  <div className="hidden h-3.5 w-px bg-gray-300 xl:block dark:bg-gray-700" />
                  <p>{user.branchName}</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 p-5 lg:p-6 dark:border-gray-800">
        <h4 className="text-lg font-semibold text-gray-800 lg:mb-6 dark:text-white/90">
          Account Details
        </h4>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-7 2xl:gap-x-32">
          <Field label="Name" value={user.name} />
          <Field label="Mobile Number" value={user.mobile} />
          <Field label="Email Address" value={user.email} />
          <Field label="Organization" value={user.orgCode} />
          {/* Branch is shown for a branch-scoped user only. A Super Admin has
              no branch, and "Not recorded" would read as missing data rather
              than as the unscoped access it actually is. */}
          {user.branchName && (
            <Field label="Branch" value={user.branchName} />
          )}
          <Field label="Roles" value={user.roles.join(", ")} />
        </div>

        <p className="mt-6 border-t border-gray-200 pt-5 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          These details are maintained by your administrator. To change your
          password, go to{" "}
          <Link
            href="/change-password"
            className="text-brand-500 hover:text-brand-600 dark:text-brand-400 font-medium"
          >
            Change Password
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
