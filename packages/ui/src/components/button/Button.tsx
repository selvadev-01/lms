import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import React, { type ReactNode } from "react";

import { cx } from "../../lib/cn";

const button = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-control font-medium transition-colors select-none",
    // A visible focus ring is the only way a keyboard user can tell where they
    // are. `focus-visible` keeps it off mouse clicks.
    "focus-visible:ring-focus focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:bg-accent-hover",
        secondary:
          "border-line bg-surface text-ink hover:bg-surface-sunken border",
        ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
        destructive: "bg-critical text-white hover:opacity-90",
        link: "text-accent h-auto p-0 underline-offset-4 hover:underline",
        /**
         * @deprecated Alias for `secondary`, kept so the ~55 call sites on
         * not-yet-converted pages (mostly per-route `error.tsx` boundaries)
         * keep rendering while the redesign converts screens in phases.
         * Use `secondary` in new code; remove this once the last caller moves.
         */
        outline:
          "border-line bg-surface text-ink hover:bg-surface-sunken border",
      },
      size: {
        xs: "h-7 px-2 text-xs",
        sm: "h-8 px-3 text-sm",
        md: "h-9 px-4 text-sm",
        // 44px: the minimum comfortable touch target. The default for field
        // routes, which are used one-handed and outdoors.
        lg: "h-11 px-5 text-base",
        "icon-sm": "h-8 w-8 p-0",
        icon: "h-9 w-9 p-0",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    // `link` has no box, so a height would push the text off its baseline.
    compoundVariants: [
      { variant: "link", size: ["xs", "sm", "md", "lg"], class: "h-auto px-0" },
    ],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof button>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof button>["size"]>;

export interface ButtonProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    VariantProps<typeof button> {
  children?: ReactNode;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  /**
   * Defaults to `"button"`.
   *
   * The DOM default is `"submit"`, which used to make every `<Button>` inside a
   * form submit it — including ones that only had an `onClick`, so a click ran
   * the handler *and* posted the form. Submitting is now something a caller
   * asks for explicitly.
   */
  type?: "button" | "submit" | "reset";
  /**
   * Shows a spinner and disables the button. The label stays in the DOM so the
   * accessible name does not change mid-flight — `getByRole("button", { name })`
   * keeps matching, and a screen reader does not re-announce the control.
   */
  loading?: boolean;
  /**
   * Renders the single child element instead of a `<button>`, keeping these
   * styles. Use it for navigation that should look like a button:
   *
   *   <Button asChild><Link href="/customers/new">Add Customer</Link></Button>
   *
   * A `<Link>` wrapped *around* a Button nests an anchor and a button, which
   * gives a screen reader two controls for one action and, before `type`
   * defaulted to `"button"`, also submitted any enclosing form. `asChild`
   * produces one element with the right role.
   */
  asChild?: boolean;
}

const Spinner = () => (
  <svg
    className="h-4 w-4 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
  </svg>
);

/**
 * The one button. Renders a native `<button>`, or the child element when
 * `asChild` is set — see that prop for why a `<Link>` should go inside rather
 * than around.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      size,
      variant,
      fullWidth,
      startIcon,
      endIcon,
      className,
      type = "button",
      loading = false,
      disabled = false,
      asChild = false,
      ...rest
    },
    ref,
  ) {
    if (
      process.env.NODE_ENV !== "production" &&
      type === "submit" &&
      rest.onClick
    ) {
      // Almost always a leftover from when `type` did not exist: the click
      // handler runs and the form posts, so the page navigates out from under
      // whatever the handler was doing.
      console.error(
        '[@lms/ui] <Button> has both onClick and type="submit". It will run the handler AND submit the form. Pass type="button" if you only want the handler.',
      );
    }

    if (asChild) {
      // Slot merges these props onto the child, so the child supplies the
      // element and its role. `type` and `disabled` are deliberately not
      // forwarded: they are meaningless on an anchor, and `disabled` on a link
      // would style it as unavailable while leaving it fully clickable.
      return (
        <Slot
          className={cx(button({ variant, size, fullWidth }), className)}
          {...rest}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        className={cx(button({ variant, size, fullWidth }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <Spinner /> : startIcon}
        {children}
        {!loading && endIcon}
      </button>
    );
  },
);

export default Button;
