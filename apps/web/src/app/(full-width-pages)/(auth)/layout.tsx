import GridShape from "@/components/common/GridShape";
import ThemeTogglerTwo from "@/components/common/ThemeTogglerTwo";

import Image from "next/image";
import Link from "next/link";
import React from "react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative z-1 bg-white p-6 sm:p-0 dark:bg-gray-900">
      {/* `min-h-screen`, not `h-screen`: the taller signup form must be able to
          grow past the viewport and scroll rather than being clipped. */}
      <div className="relative flex min-h-screen w-full flex-col justify-center sm:p-0 lg:flex-row dark:bg-gray-900">
        {children}
        {/* `self-stretch` rather than `h-full`: the flex parent is now
            `min-h-screen`, so its height is auto and a percentage height would
            collapse the panel. */}
        <div className="bg-brand-950 relative hidden w-full items-center self-stretch overflow-hidden lg:grid lg:w-1/2 dark:bg-white/5">
          {/* A soft radial wash over the flat brand colour, so the panel has
              some depth behind the grid artwork instead of reading as a slab.
              Written as an inline style rather than an arbitrary Tailwind
              value: a `radial-gradient` carrying its own comma-separated
              `color-mix()` does not survive the class scanner, and the layer
              silently renders invisible.

              `z-0`, not `-z-1`: a negative z-index would put the wash behind
              the panel's own `bg-brand-950`, which paints over it. The content
              below sits at `z-1` and so still stacks above this. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 z-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 25% 15%, color-mix(in srgb, var(--color-brand-500) 38%, transparent), transparent 60%)",
            }}
          />
          <div className="relative z-1 flex items-center justify-center">
            {/* <!-- ===== Common Grid Shape Start ===== --> */}
            <GridShape />
            <div className="flex max-w-sm flex-col items-center px-8">
              <Link href="/" className="mb-6 block">
                <Image
                  width={231}
                  height={48}
                  src="/images/logo/auth-logo.svg"
                  alt="Logo"
                />
              </Link>
              <p className="text-center text-lg leading-relaxed font-medium text-white/90">
                Lending operations, end to end.
              </p>
              <p className="mt-3 text-center text-sm leading-relaxed text-gray-400 dark:text-white/60">
                Customers, applications, disbursals, collections and
                reconciliation — in one place.
              </p>
            </div>
          </div>
        </div>
        <div className="fixed right-6 bottom-6 z-50 hidden sm:block">
          <ThemeTogglerTwo />
        </div>
      </div>
    </div>
  );
}
