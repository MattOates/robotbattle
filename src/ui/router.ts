/**
 * Hash routing, hand-rolled.
 *
 * Six screens, no nesting, one optional parameter. A routing library would be
 * more code to read than this is to write, and hash routes mean the game can be
 * opened from a file:// URL or any static host without server rewrites — which
 * matters for something meant to be handed round a classroom.
 */

import { useEffect, useState } from "react";

export type ScreenName =
  | "menu"
  | "workshop"
  | "arena"
  | "tournament"
  | "pair"
  | "trade";

export interface Route {
  screen: ScreenName;
  /** Room code, for the modes that join one. */
  room: string | null;
}

const SCREENS: ReadonlySet<string> = new Set<ScreenName>([
  "menu",
  "workshop",
  "arena",
  "tournament",
  "pair",
  "trade",
]);

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [screen = "", room = ""] = path.split("/");
  const name = screen.toLowerCase();
  return {
    screen: SCREENS.has(name) ? (name as ScreenName) : "menu",
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
