/**
 * RoboScript <-> Blockly, both ways, as plain JSON.
 *
 * The block editor is a third view over the same script — see
 * `workshop/compose.ts` for why every view is a view and never a second
 * format. This module is the hinge, and it is deliberately pure: it maps a
 * `Sketch` to and from Blockly's own serialisation format
 * (`Blockly.serialization.workspaces.save/load`), which is ordinary JSON with
 * no DOM in it. That is what lets `tests/workshop/blocks.test.ts` assert the
 * round trip without a browser, exactly as the card view's is asserted.
 *
 * Blocks are generated from the same `CARDS` catalogue the cards use, so there
 * is one table of what a {robot} can be made of and three ways of showing it.
 * Adding a card adds a block.
 *
 * ## Comments are blocks
 *
 * A block editor normally eats comments: the workspace is the truth and code
 * is generated from it, so anything with no block is gone the moment somebody
 * drags something. Here a run of comment lines is a block of its own — carried,
 * shown, moved and re-emitted like any other. So a {robot} handed to you with
 * its author's notes still has them after you change it, which is the same
 * promise the card view keeps by holding every line verbatim.
 */

import {
  CARDS,
  cardSpec,
  cardText,
  type Block,
  type Card,
  type Sketch,
} from "../../workshop/compose.js";

/** Blockly's serialised shape, as much of it as this module touches. */
export interface BlockJson {
  type: string;
  id?: string;
  fields?: Record<string, string | number>;
  extraState?: Record<string, unknown>;
  next?: { block: BlockJson };
  inputs?: Record<string, { block: BlockJson }>;
}

export interface WorkspaceJson {
  blocks?: { languageVersion: number; blocks: BlockJson[] };
  /** Ours, not Blockly's: the declarations that are not behaviour. */
  rb?: { head?: string[]; tail?: string[] };
}

export const BLOCK_PREFIX = "rb_";
export const WHEN_BLOCK = `${BLOCK_PREFIX}when`;
export const COMMENT_BLOCK = `${BLOCK_PREFIX}comment`;
export const RAW_BLOCK = `${BLOCK_PREFIX}raw`;

export function blockTypeFor(specId: string): string {
  return `${BLOCK_PREFIX}${specId.replace(/-/g, "_")}`;
}

export function specIdFor(blockType: string): string | null {
  if (!blockType.startsWith(BLOCK_PREFIX)) return null;
  const id = blockType.slice(BLOCK_PREFIX.length).replace(/_/g, "-");
  return CARDS.some((c) => c.id === id) ? id : null;
}

/** Chain statement blocks through Blockly's `next` links. */
function chain(blocks: BlockJson[]): BlockJson | undefined {
  if (blocks.length === 0) return undefined;
  for (let i = blocks.length - 2; i >= 0; i--) {
    blocks[i]!.next = { block: blocks[i + 1]! };
  }
  return blocks[0];
}

/** Undo `chain`: walk a `next` list back into an array. */
function unchain(first: BlockJson | undefined): BlockJson[] {
  const out: BlockJson[] = [];
  let at = first;
  while (at) {
    const { next, ...rest } = at;
    out.push(rest as BlockJson);
    at = next?.block;
  }
  return out;
}

/**
 * A card's leading comments and the card itself.
 *
 * The lead comes first, where it was written. Blank lines inside a run are
 * kept in the block's text so reassembling reproduces the spacing rather than
 * collapsing it.
 */
/**
 * A run of comments as one editable line, with the original kept beside it.
 *
 * Blockly 13 has no multi-line field in core, and a comment run is often
 * several lines with blanks among them. So the *field* is the readable body on
 * one line — the `--` markers and the indentation stripped, because they are
 * punctuation rather than content — and the lines as written ride in
 * `extraState`. Untouched, the original comes back exactly; edited, it becomes
 * one tidy comment line. The same bargain the statement blocks make.
 */
function commentBlock(lines: string[]): BlockJson {
  return {
    type: COMMENT_BLOCK,
    fields: { TEXT: readable(lines) },
    extraState: { lines },
  };
}

/** The body of a comment run, for reading and editing. */
export function readable(lines: string[]): string {
  return lines
    .map((l) => l.trim().replace(/^--\s?/, ""))
    .filter((l) => l !== "")
    .join(" ");
}

function cardBlocks(card: Card): BlockJson[] {
  const out: BlockJson[] = [];
  if (card.lead.length > 0) {
    out.push(commentBlock(card.lead));
  }
  if (card.text === "") return out;

  const spec = cardSpec(card.spec);
  if (!spec) {
    out.push({ type: RAW_BLOCK, fields: { CODE: card.text } });
    return out;
  }
  const fields: Record<string, string | number> = {};
  card.holes.forEach((hole, i) => {
    fields[`V${i}`] = hole.value;
  });
  /*
   * The line as it was written travels with the block.
   *
   * Without it every statement is regenerated from the catalogue on the way
   * back, and the catalogue speaks canonical RoboScript — so a biological
   * script went in saying `sting 3` and came out saying `fire 3`. It still
   * compiled, and it was still not the {robot} anybody wrote. The block keeps
   * its own text and its own indentation, and only a block whose values have
   * actually been changed is written afresh.
   */
  out.push({
    type: blockTypeFor(spec.id),
    fields,
    extraState: { text: card.text, was: card.holes.map((h) => h.value) },
  });
  return out;
}

function blockJsonFor(block: Block): BlockJson {
  const body = chain(block.cards.flatMap(cardBlocks));
  const json: BlockJson = {
    type: WHEN_BLOCK,
    fields: { EVENT: block.event ?? "" },
    extraState: { header: block.header, lead: block.lead, close: block.close },
  };
  if (body) json.inputs = { DO: { block: body } };
  return json;
}

/**
 * A sketch, as a workspace.
 *
 * The head (name, chassis, colour, globals) and the tail ride in our own
 * `rb` key rather than becoming blocks. They are declarations rather than
 * behaviour, they are edited elsewhere, and modelling them as blocks would put
 * `chassis tank` on the canvas as a thing to drag.
 */
export function sketchToWorkspace(sketch: Sketch): WorkspaceJson {
  return {
    blocks: { languageVersion: 0, blocks: sketch.blocks.map(blockJsonFor) },
    rb: { head: sketch.head, tail: sketch.tail },
  };
}

/** And back. */
export function workspaceToSketch(json: WorkspaceJson): Sketch {
  const blocks: Block[] = [];
  let n = 0;

  for (const hat of json.blocks?.blocks ?? []) {
    if (hat.type !== WHEN_BLOCK) continue;
    const extra = (hat.extraState ?? {}) as {
      header?: string;
      lead?: string[];
      close?: string | null;
    };
    const statements = unchain(hat.inputs?.["DO"]?.block);

    const cards: Card[] = [];
    let lead: string[] = [];
    for (const st of statements) {
      if (st.type === COMMENT_BLOCK) {
        const kept = ((st.extraState ?? {}) as { lines?: string[] }).lines;
        const text = String(st.fields?.["TEXT"] ?? "");
        // Untouched: put back what was written, blank lines and all.
        if (kept && readable(kept) === text) lead.push(...kept);
        else if (text !== "") lead.push(`  -- ${text}`);
        continue;
      }
      if (st.type === RAW_BLOCK) {
        cards.push({
          id: `b${++n}`,
          spec: "raw",
          holes: [],
          text: String(st.fields?.["CODE"] ?? ""),
          lead,
        });
        lead = [];
        continue;
      }
      const specId = specIdFor(st.type);
      const spec = specId ? cardSpec(specId) : undefined;
      if (!spec) continue;
      const holes = spec.holes.map((h, i) => ({
        kind: h.kind,
        value: String(st.fields?.[`V${i}`] ?? h.default),
      }));
      const kept = (st.extraState ?? {}) as { text?: string; was?: string[] };
      // Untouched means untouched: same values as it went in with, so the
      // line it came from is still the right line, in the player's own words.
      const unchanged =
        kept.text !== undefined &&
        kept.was !== undefined &&
        kept.was.length === holes.length &&
        kept.was.every((v, i) => v === holes[i]!.value);
      const indent = kept.text ? (/^\s*/.exec(kept.text)?.[0] ?? "  ") : "  ";
      cards.push({
        id: `b${++n}`,
        spec: spec.id,
        holes,
        text: unchanged ? kept.text! : cardText(spec, holes, indent),
        lead,
      });
      lead = [];
    }
    // A run of comments with nothing after it still has to come out.
    if (lead.length > 0) {
      cards.push({ id: `b${++n}`, spec: "raw", holes: [], text: "", lead });
    }

    const event = String(hat.fields?.["EVENT"] ?? "") || null;
    blocks.push({
      id: `h${++n}`,
      header: extra.header ?? `on ${event ?? "start"}`,
      event: (event as Block["event"]) ?? null,
      cards,
      lead: extra.lead ?? [],
      close: extra.close === undefined ? "end" : extra.close,
    });
  }

  return { head: json.rb?.head ?? [], blocks, tail: json.rb?.tail ?? [] };
}
