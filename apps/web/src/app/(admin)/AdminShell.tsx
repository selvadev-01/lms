"use client";

import React from "react";

import { useSidebar } from "@/context/SidebarContext";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import type { ChromeUser } from "@/layout/chrome-user";

/**
 * The admin shell's client half — everything that needs sidebar state.
 *
 * Split out of `layout.tsx` when the sidebar gained permission gating: the
 * layout had to become a server component in order to read the session, and this
 * is the part that could not follow it there.
 */
export default function AdminShell({
  children,
  permissions,
  user,
}: {
  children: React.ReactNode;
  permissions: string[];
  user: ChromeUser | null;
}) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  // Dynamic class for main content margin based on sidebar state.
  // The widths mirror `AppSidebar`'s own `w-[290px]` / `w-[90px]` — the two
  // files are the only owners of these numbers and must change together.
  const mainContentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
      ? "lg:ml-[290px]"
      : "lg:ml-[90px]";

  return (
    <div className="min-h-screen xl:flex">
      {/* First focusable element on the page. A keyboard or screen-reader user
          would otherwise tab through the entire sidebar nav on every
          navigation before reaching the content they asked for. Visually
          hidden until focused. */}
      <a
        href="#main-content"
        className="bg-surface text-ink border-line focus:ring-focus rounded-control sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:border focus:px-4 focus:py-2 focus:ring-2 focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Sidebar and Backdrop */}
      <AppSidebar permissions={permissions} />
      <Backdrop />
      {/* Main Content Area */}
      <div
        className={`flex-1 transition-all duration-300 ease-in-out ${mainContentMargin}`}
      >
        {/* Header */}
        <AppHeader user={user} permissions={permissions} />
        {/* Page Content. `main` is the landmark the skip link targets and the
            one assistive tech uses to jump past the chrome; `tabIndex={-1}`
            makes it a valid focus target without adding it to the tab order. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-(--breakpoint-2xl) p-4 focus:outline-none md:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
