"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the browser currently believes it is online.
 *
 * The source flow branches on `Network Available?` before GPS check-in, so the
 * screen needs this to route between the online and Offline Mode paths.
 *
 * Built on `useSyncExternalStore` rather than `useState` + `useEffect`:
 * `navigator.onLine` is exactly the external mutable source that hook exists
 * for. It also gives a separate server snapshot, so the server and the first
 * client render agree without a setState-on-mount that would cascade a second
 * render.
 *
 * Two caveats worth knowing, because they shape how this is used:
 *
 *   1. `navigator.onLine` is a lower bound, not a guarantee. `false` reliably
 *      means offline; `true` only means an interface is up, not that the API is
 *      reachable. So this routes *into* Offline Mode, and never concludes that
 *      a check-in will succeed — that verdict comes from the server (Rule 19).
 *   2. The server snapshot is `true`, because there is no navigator to ask. An
 *      offline user sees the online panel for one render before hydration
 *      corrects it, which is the right way round: a brief optimistic render
 *      beats falsely announcing Offline Mode to someone who is connected.
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);

  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

export function useNetworkStatus(): boolean {
  const getSnapshot = useCallback(() => navigator.onLine, []);
  const getServerSnapshot = useCallback(() => true, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
