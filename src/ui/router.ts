/**
 * Hash routing, hand-rolled.
 *
 * Six screens, no nesting, one optional parameter. A routing library would be
 * more code to read than this is to write, and hash routes mean the game can be
 * opened from a file:// URL or any static host without server rewrites — which
 * matters for something meant to be handed round a classroom.
 */

import { useEffect, useState } from "react";

/**
 * Every screen, once. `ScreenName` is derived from the list rather than
 * declared beside it, so adding a screen to one and not the other — which used
 * to give a route that type-checked and silently fell back to the menu — is no
 * longer possible.
 */
export const SCREENS = [
  "menu",
  "workshop",
  "arena",
  "tournament",
  "pair",
  "trade",
  "about",
  "learn",
  "reference",
] as const;

export type ScreenName = (typeof SCREENS)[number];

export interface Route {
  screen: ScreenName;
  /** Room code, for the modes that join one. */
  room: string | null;
}

const KNOWN: ReadonlySet<string> = new Set<string>(SCREENS);

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [screen = "", room = ""] = path.split("/");
  // Pair Program was folded into the Workshop; links already handed out keep
  // working rather than landing on the menu with no explanation.
  const name = screen.toLowerCase() === "pair" ? "workshop" : screen.toLowerCase();
  return {
    screen: KNOWN.has(name) ? (name as ScreenName) : "menu",
    room: room ? decodeURIComponent(room).toUpperCase() : null,
  };
}

export function routePath(screen: ScreenName, room?: string): string {
  if (screen === "menu") return "#/";
  return room ? `#/${screen}/${encodeURIComponent(room)}` : `#/${screen}`;
}

export function navigate(screen: ScreenName, room?: string): void {
  window.location.hash = routePath(screen, room);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(typeof window === "undefined" ? "" : window.location.hash),
  );

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    // The hash may already have changed between render and effect.
    onChange();
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
