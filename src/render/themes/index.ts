import type { Theme } from "../../lang/vocab.js";
import { BIOLOGICAL } from "./biological.js";
import { MECHANICAL } from "./mechanical.js";
import type { ArenaTheme } from "./types.js";

export const ART: Readonly<Record<Theme, ArenaTheme>> = {
  mechanical: MECHANICAL,
  biological: BIOLOGICAL,
};

export { MECHANICAL, BIOLOGICAL };
export type { ArenaTheme };
export { hexToNumber, darken, lighten } from "./types.js";
