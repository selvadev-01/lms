"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSidebar } from "../context/SidebarContext";
import { ChevronDownIcon, HorizontaLDots } from "@lms/ui/icons";
import {
  type NavItem,
  type NavSection,
  navSections,
  resolveActivePath,
  submenuId,
  visibleSections,
} from "./nav-items";

export interface AppSidebarProps {
  /**
   * The caller's effective permissions, resolved server-side and passed down.
   *
   * A prop rather than a client-side auth context: the context would exist
   * solely for this component, and the layout above it already runs on the
   * server where the session is available.
   */
  permissions?: string[];
}

/**
 * Identity of an open accordion.
 *
 * The section and item names, not an index into the rendered array: a
 * permission that hides an earlier group would otherwise shift every index
 * after it and open the wrong group.
 */
type OpenGroup = { sectionId: string; itemName: string };

const AppSidebar: React.FC<AppSidebarProps> = ({ permissions = [] }) => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered, closeMobile } =
    useSidebar();
  const pathname = usePathname();

  const sections = visibleSections(navSections, permissions);

  /** Whether labels are shown; the collapsed rail is icons only. */
  const showLabels = isExpanded || isHovered || isMobileOpen;

  // The single entry the route belongs to, resolved across every visible entry
  // so the most specific one wins. Exact equality per entry would leave every
  // detail route — `/customers/{id}`, `/loans/applications/new` — with nothing
  // highlighted and its group snapped shut.
  const activePath = resolveActivePath(sections, pathname);

  // The user's manual toggle, which overrides the route-derived default until
  // the route changes again. `null` value means "closed", the whole override
  // being absent means "follow the route".
  const [override, setOverride] = useState<{
    pathname: string;
    value: OpenGroup | null;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {},
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Which group contains the active entry. Derived, not stored — keeping it in
  // state would mean a second render on every navigation.
  const routeGroup = ((): OpenGroup | null => {
    if (!activePath) return null;
    for (const section of sections) {
      for (const item of section.items) {
        if (item.subItems?.some((s) => s.path === activePath)) {
          return { sectionId: section.id, itemName: item.name };
        }
      }
    }
    return null;
  })();

  const openGroup =
    override?.pathname === pathname ? override.value : routeGroup;

  // Depended on as a primitive, not as `openGroup` itself: the block above
  // builds a fresh object on every render, so an object dependency never
  // compares equal and the effect below would re-run and setState forever
  // ("Maximum update depth exceeded"). The key is the only part it reads.
  const openKey = openGroup
    ? submenuId(openGroup.sectionId, openGroup.itemName)
    : null;

  // Measure the open group so its animated height can be set. `showLabels` is a
  // dependency, not just `openKey`: the submenu is not rendered at all on the
  // collapsed rail, so the ref is null while collapsed and the measurement has
  // to be retaken the moment labels come back. Without it a group that was
  // already open when the rail collapsed re-expands to a height of 0.
  useEffect(() => {
    if (openKey !== null && subMenuRefs.current[openKey]) {
      setSubMenuHeight((prev) => ({
        ...prev,
        [openKey]: subMenuRefs.current[openKey]?.scrollHeight || 0,
      }));
    }
  }, [openKey, showLabels]);

  // Not wrapped in useCallback: `openGroup` is rebuilt each render, so a manual
  // dependency array cannot be preserved and would disable the React Compiler's
  // optimization of this whole component.
  const isOpen = (sectionId: string, itemName: string) =>
    openGroup?.sectionId === sectionId && openGroup?.itemName === itemName;

  const toggleGroup = (sectionId: string, itemName: string) => {
    setOverride({
      pathname,
      value: isOpen(sectionId, itemName) ? null : { sectionId, itemName },
    });
  };

  // The mobile drawer is a modal surface: Escape closes it, as it does every
  // other overlay in the app. Without this the only way out is the backdrop,
  // which a keyboard user cannot reach.
  useEffect(() => {
    if (!isMobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobile();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileOpen, closeMobile]);

  const renderItem = (section: NavSection, nav: NavItem) => {
    const open = isOpen(section.id, nav.name);
    const id = submenuId(section.id, nav.name);

    return (
      <li key={nav.name}>
        {nav.subItems ? (
          <button
            type="button"
            onClick={() => toggleGroup(section.id, nav.name)}
            aria-expanded={open}
            aria-controls={id}
            className={`menu-item group ${
              open ? "menu-item-active" : "menu-item-inactive"
            } cursor-pointer ${
              showLabels ? "lg:justify-start" : "lg:justify-center"
            }`}
          >
            <span
              className={
                open ? "menu-item-icon-active" : "menu-item-icon-inactive"
              }
            >
              {nav.icon}
            </span>
            {showLabels && <span className="truncate">{nav.name}</span>}
            {showLabels && (
              <ChevronDownIcon
                aria-hidden="true"
                className={`ml-auto h-5 w-5 shrink-0 transition-transform duration-200 ${
                  open ? "text-brand-500 rotate-180" : ""
                }`}
              />
            )}
            {/* The collapsed rail has no label, so the button needs an
                accessible name from somewhere. */}
            {!showLabels && <span className="sr-only">{nav.name}</span>}
          </button>
        ) : (
          nav.path && (
            <Link
              href={nav.path}
              aria-current={activePath === nav.path ? "page" : undefined}
              className={`menu-item group ${
                activePath === nav.path
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } ${showLabels ? "lg:justify-start" : "lg:justify-center"}`}
            >
              <span
                className={
                  activePath === nav.path
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }
              >
                {nav.icon}
              </span>
              {showLabels ? (
                <span className="truncate">{nav.name}</span>
              ) : (
                <span className="sr-only">{nav.name}</span>
              )}
            </Link>
          )
        )}

        {nav.subItems && showLabels && (
          <div
            id={id}
            ref={(el) => {
              subMenuRefs.current[id] = el;
            }}
            className="overflow-hidden transition-all duration-300"
            style={{ height: open ? `${subMenuHeight[id] ?? 0}px` : "0px" }}
          >
            <ul className="mt-2 ml-9 space-y-1">
              {nav.subItems.map((subItem) => (
                <li key={subItem.name}>
                  <Link
                    href={subItem.path}
                    aria-current={
                      activePath === subItem.path ? "page" : undefined
                    }
                    // Not focusable while the group is collapsed to 0px: a
                    // keyboard user would otherwise tab into links they cannot
                    // see, and the sidebar would scroll to an invisible target.
                    tabIndex={open ? undefined : -1}
                    className={`menu-dropdown-item ${
                      activePath === subItem.path
                        ? "menu-dropdown-item-active"
                        : "menu-dropdown-item-inactive"
                    }`}
                  >
                    {subItem.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </li>
    );
  };

  return (
    /* `h-[calc(100vh-4rem)]` on mobile, not `h-screen`: the drawer is pushed
       down by `mt-16` to clear the header, so a full-viewport height put its
       last 4rem below the fold and the final nav entries were unreachable.
       On `lg` the `mt-0` restores the full height. */
    <aside
      className={`fixed top-0 left-0 z-999999 mt-16 flex h-[calc(100vh-4rem)] flex-col border-r border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out lg:z-50 lg:mt-0 lg:h-screen dark:border-gray-800 dark:bg-gray-900 ${
        showLabels ? "w-[290px]" : "w-[90px]"
      } ${isMobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`flex py-8 ${showLabels ? "justify-start" : "lg:justify-center"}`}
      >
        <Link href="/">
          {showLabels ? (
            <>
              <Image
                className="dark:hidden"
                src="/images/logo/logo.svg"
                alt="Logo"
                width={150}
                height={40}
              />
              <Image
                className="hidden dark:block"
                src="/images/logo/logo-dark.svg"
                alt="Logo"
                width={150}
                height={40}
              />
            </>
          ) : (
            <Image
              src="/images/logo/logo-icon.svg"
              alt="Logo"
              width={32}
              height={32}
            />
          )}
        </Link>
      </div>

      {/* `flex-1 min-h-0`: without it this claims only its content height, so
          a nav list taller than the sidebar overflows instead of scrolling.
          `min-h-0` is required because a flex item's default `min-height:auto`
          refuses to shrink below its content, defeating `overflow-y-auto`. */}
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto duration-300 ease-linear">
        <nav aria-label="Main navigation" className="mb-6">
          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <div key={section.id}>
                <h2
                  id={`nav-heading-${section.id}`}
                  className={`mb-4 flex text-xs leading-[20px] text-gray-400 uppercase ${
                    showLabels ? "justify-start" : "lg:justify-center"
                  }`}
                >
                  {showLabels ? (
                    section.title
                  ) : (
                    <>
                      <HorizontaLDots aria-hidden="true" />
                      <span className="sr-only">{section.title}</span>
                    </>
                  )}
                </h2>
                <ul
                  aria-labelledby={`nav-heading-${section.id}`}
                  className="flex flex-col gap-4"
                >
                  {section.items.map((nav) => renderItem(section, nav))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;
