"use client";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useSyncExternalStore,
} from "react";

type SidebarContextType = {
  isExpanded: boolean;
  isMobileOpen: boolean;
  isHovered: boolean;
  toggleSidebar: () => void;
  toggleMobileSidebar: () => void;
  closeMobile: () => void;
  setIsHovered: (isHovered: boolean) => void;
};

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

/** Where the collapsed/expanded choice is remembered between visits. */
const STORAGE_KEY = "lms.sidebar.expanded";

/**
 * The stored preference, or null if there is none to read.
 *
 * Wrapped because the access itself throws, not merely returns empty: a browser
 * set to block site data raises on `localStorage`, and the sidebar has to
 * render regardless of whether it can remember anything.
 *
 * Returns a primitive, which is what makes it safe as a `useSyncExternalStore`
 * snapshot — a fresh object each call would re-render forever.
 */
function readStoredExpanded(): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : raw === "true";
  } catch {
    return null;
  }
}

/**
 * Notifies React when the preference changes.
 *
 * `storage` fires only for *other* tabs, which is the useful half: collapsing
 * the sidebar in one tab settles the others. The local write re-renders through
 * `setOverride` instead, since `storage` does not fire in the tab that wrote.
 */
function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Read through `useSyncExternalStore` rather than restored in an effect, so
  // there is no second render and no visible flick from expanded to collapsed.
  //
  // Hydration is why it is not a plain `useState` initializer: that also runs
  // on the client's first pass, where returning the stored value would make the
  // client's markup differ from the server's. This hook returns the server
  // snapshot until hydration finishes and the stored one after, so React never
  // compares mismatched trees.
  const stored = useSyncExternalStore(
    subscribeToStorage,
    readStoredExpanded,
    () => null, // The server has no preference to report.
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // This session's choice wins over the stored one, which wins over the
  // expanded default.
  const isExpanded = override ?? stored ?? true;

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setIsMobileOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const toggleSidebar = () => {
    const next = !isExpanded;
    setOverride(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Storage is blocked; the choice holds for this session only.
    }
  };

  const toggleMobileSidebar = () => {
    setIsMobileOpen((prev) => !prev);
  };

  const closeMobile = () => {
    setIsMobileOpen(false);
  };

  return (
    <SidebarContext.Provider
      value={{
        isExpanded: isMobile ? false : isExpanded,
        isMobileOpen,
        isHovered,
        toggleSidebar,
        toggleMobileSidebar,
        closeMobile,
        setIsHovered,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
};
