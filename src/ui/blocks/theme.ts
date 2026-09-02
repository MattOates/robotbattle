/**
 * The block canvas, dressed in whichever skin is on.
 *
 * This started as a handful of CSS overrides against Blockly's own class
 * names, which is the wrong tool twice over. Blockly draws its workspace,
 * toolbox and flyout as SVG with colours it computes itself, so a stylesheet
 * can only reach some of them — the toolbox labels stayed grey-on-grey and the
 * menu was, fairly, described as illegible. And overriding a library's
 * internal class names is a bet on those names, which is a bet you lose
 * quietly on the next upgrade.
 *
 * Blockly has a real answer: a `Theme`, whose `componentStyles` name exactly
 * these surfaces. So the theme is built here instead — and built from the
 * instrument's own CSS custom properties, read off the document at the moment
 * the workspace is created. That is what makes it follow both adult skins
 * without a second table: the mechanical and biological arenas retune
 * `--panel`, `--well` and `--ink` between them, and the block canvas simply
 * inherits whatever they are now.
 *
 * The block *hues* are deliberately not themed. A `fire` block should be the
 * same colour whoever is looking at it: somebody moving up from the playground
 * skin has already learnt what the orange ones do, and relearning that at the
 * moment they are also learning to read code would be a poor trade.
 */

import * as Blockly from "blockly/core";

/** Read one CSS custom property off the root element. */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/**
 * Blockly wants opaque colours it can put straight into SVG attributes, and
 * some of the tokens are translucent. Anything it cannot parse it silently
 * ignores, which would leave the surface at its light default — so the few
 * that matter are resolved to solid values here.
 */
function solid(name: string, fallback: string): string {
  const value = token(name, fallback);
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

let cached: { key: string; theme: Blockly.Theme } | null = null;

/**
 * A theme for the skin that is currently on.
 *
 * Cached by skin and arena rather than rebuilt: `defineTheme` registers the
 * theme by name, and registering the same name twice throws.
 */
export function themeFor(skin: string, arena: string): Blockly.Theme {
  const key = `${skin}-${arena}`;
  if (cached?.key === key) return cached.theme;

  const light = skin === "playground";
  const theme = Blockly.Theme.defineTheme(`robobattle-${key}-${Date.now()}`, {
    name: `robobattle-${key}`,
    base: Blockly.Themes.Zelos,
    componentStyles: {
      // The canvas itself, and the grid Blockly draws on it.
      workspaceBackgroundColour: solid("--well", light ? "#f7f5ef" : "#12150f"),
      // The category column and the words in it. This is the one that was
      // illegible: Blockly's default foreground is a dark grey chosen for a
      // white column, and the column here is nearly black.
      toolboxBackgroundColour: solid("--panel", light ? "#ffffff" : "#1e221c"),
      toolboxForegroundColour: solid("--ink", light ? "#23261f" : "#d6d3c2"),
      // The drawer that slides out of it.
      flyoutBackgroundColour: solid("--well-deep", light ? "#ebe7dc" : "#0d0f0b"),
      flyoutForegroundColour: solid("--ink-muted", light ? "#5c604f" : "#838772"),
      flyoutOpacity: 1,
      scrollbarColour: solid("--bezel-light", light ? "#c2bba9" : "#3a4034"),
      scrollbarOpacity: 0.6,
      // Where a dragged block will land, and the keyboard cursor.
      insertionMarkerColour: solid("--signal", "#e8a33d"),
      insertionMarkerOpacity: 0.5,
      markerColour: solid("--signal", "#e8a33d"),
      cursorColour: solid("--signal", "#e8a33d"),
      selectedGlowColour: solid("--signal", "#e8a33d"),
      selectedGlowOpacity: 0.6,
    },
  });

  cached = { key, theme };
  return theme;
}

/** What the workspace should be rebuilt for. */
export function themeKey(): string {
  if (typeof document === "undefined") return "instrument-mechanical";
  const root = document.documentElement;
  return `${root.dataset["skin"] ?? "instrument"}-${root.dataset["arena"] ?? "mechanical"}`;
}
