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
  NESTS,
  eventOfHeader,
  joinArgs,
  parseCanHeader,
  splitArgs,
  cardSpec,
  cardText,
  isNest,
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
/** A named behaviour: `can dodge given hit by bullet`. */
export const CAN_BLOCK = `${BLOCK_PREFIX}can`;
/** The declarations at the top of the file: name, chassis, colour, globals. */
export const ROBOT_BLOCK = `${BLOCK_PREFIX}robot`;
export const COMMENT_BLOCK = `${BLOCK_PREFIX}comment`;
export const RAW_BLOCK = `${BLOCK_PREFIX}raw`;
/** Value blocks: the things that plug into a condition socket. */
export const COMPARE_BLOCK = `${BLOCK_PREFIX}compare`;
export const PROP_BLOCK = `${BLOCK_PREFIX}prop`;
export const VAR_BLOCK = `${BLOCK_PREFIX}var_get`;
export const NUM_BLOCK = `${BLOCK_PREFIX}num`;
export const EXPR_BLOCK = `${BLOCK_PREFIX}expr`;

/** The comparisons a condition may use, longest first so `<=` beats `<`. */
export const COMPARISONS = ["isnt", "is", "<=", ">=", "<", ">"] as const;

/**
 * A condition as blocks, when it has the shape almost every condition has.
 *
 * `me.health < 30`, `event.distance > 120`, `seen is 0` — a thing, a
 * comparison, a value. That covers what a script actually says, and anything
 * else (arithmetic, `and`/`or`, a call) stays as one text block holding the
 * expression verbatim. The same bargain the statements make: recognise what
 * you can, carry the rest as written, lose nothing.
 */
export function conditionToBlock(expr: string): BlockJson {
  const text = expr.trim();
  for (const op of COMPARISONS) {
    // Spaces either side, so `isnt` inside a name and a negative number are
    // both left alone.
    const at = text.indexOf(` ${op} `);
    if (at === -1) continue;
    const left = text.slice(0, at).trim();
    const right = text.slice(at + op.length + 2).trim();
    if (left === "" || right === "") continue;
    if (!isSimple(left) || !isSimple(right)) continue;
    return {
      type: COMPARE_BLOCK,
      fields: { OP: op },
      extraState: { was: text },
      inputs: { A: { block: valueBlock(left) }, B: { block: valueBlock(right) } },
    };
  }
  return { type: EXPR_BLOCK, fields: { TEXT: text } };
}

/** A property, a variable name or a number — nothing with an operator in it. */
function isSimple(text: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(text) || /^[A-Za-z_][\w.]*$/.test(text);
}

/**
 * One value, as the block that means it.
 *
 * The three are different things and were not being told apart: anything that
 * was not a number became a *property* block, so `seen` — an ordinary variable
 * somebody declared — was drawn and offered as though it were something the
 * world reports, like `me.health`. A property is `me.`, `arena.` or `event.`
 * followed by a name; a bare name is a variable; digits are a number. All
 * three are the same round shape, because all three are the same kind of
 * thing: something you can drop into a socket.
 */
export function valueBlock(text: string): BlockJson {
  const t = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return { type: NUM_BLOCK, fields: { NUM: t } };
  if (/^(me|arena|event)\.\w+$/.test(t)) return { type: PROP_BLOCK, fields: { PROP: t } };
  if (/^[A-Za-z_]\w*$/.test(t)) return { type: VAR_BLOCK, fields: { NAME: t } };
  return { type: EXPR_BLOCK, fields: { TEXT: t } };
}

/** And back, to the text a condition is written as. */
export function blockToCondition(block: BlockJson | undefined): string {
  if (!block) return "";
  if (block.type === EXPR_BLOCK) return String(block.fields?.["TEXT"] ?? "");
  if (block.type === COMPARE_BLOCK) {
    const kept = (block.extraState ?? {}) as { was?: string };
    const a = blockToCondition(block.inputs?.["A"]?.block);
    const b = blockToCondition(block.inputs?.["B"]?.block);
    const op = String(block.fields?.["OP"] ?? "is");
    const built = `${a} ${op} ${b}`;
    // Untouched conditions keep their own spacing, like every other line.
    return kept.was !== undefined && normalise(kept.was) === normalise(built) ? kept.was : built;
  }
  if (block.type === NUM_BLOCK) return String(block.fields?.["NUM"] ?? "0");
  if (block.type === PROP_BLOCK) return String(block.fields?.["PROP"] ?? "");
  if (block.type === VAR_BLOCK) return String(block.fields?.["NAME"] ?? "");
  return "";
}

const normalise = (text: string) => text.replace(/\s+/g, " ").trim();

export function blockTypeFor(specId: string): string {
  return `${BLOCK_PREFIX}${specId.replace(/-/g, "_")}`;
}

export function specIdFor(blockType: string): string | null {
  if (!blockType.startsWith(BLOCK_PREFIX)) return null;
  const id = blockType.slice(BLOCK_PREFIX.length).replace(/_/g, "-");
  if (CARDS.some((c) => c.id === id)) return id;
  return isNest(id) ? id : null;
}

/** The statement input name for one of a construct's slots. */
function slotInput(slot: string): string {
  return slot.toUpperCase();
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

function cardBlocks(card: Card, path: string): BlockJson[] {
  const out: BlockJson[] = [];
  /*
   * A note becomes a block; blank lines do not.
   *
   * Both used to: a run of two blank lines between the declarations and the
   * first handler arrived as a comment block with nothing in it, which is a
   * thing on the canvas that says nothing, cannot be usefully edited, and is
   * there because of whitespace the author never thought about. The lines
   * still have to come back, so they ride on the statement below them
   * instead — carried, and not drawn.
   */
  const pad = readable(card.lead) === "" ? card.lead : [];
  if (card.lead.length > 0 && pad.length === 0) {
    out.push({ ...commentBlock(card.lead), id: `${path}c` });
  }
  if (card.text === "") return out;

  /*
   * Deciding and repeating are the language, not decoration, so they are real
   * blocks with real statement inputs rather than a slab of text. The slots
   * recurse, which is what makes `if` inside `loop` inside `if` a tree here as
   * much as it is in the script.
   */
  if (isNest(card.spec)) {
    const fields: Record<string, string | number> = {};
    card.holes.forEach((hole, i) => {
      fields[`V${i}`] = hole.value;
    });
    const inputs: Record<string, { block: BlockJson }> = {};
    // Only `if` has a condition socket; the counts on `repeat` and `for` stay
    // as fields, because a number of times is a number and not a question.
    if (card.spec === "if" && card.holes[0]) {
      inputs["COND"] = { block: conditionToBlock(card.holes[0].value) };
    }
    for (const slot of NESTS[card.spec] ?? []) {
      const held = card.slots?.[slot];
      if (!held) continue;
      const body = chain(held.flatMap((c, i) => cardBlocks(c, `${path}${slot[0]}${i}.`)));
      if (body) inputs[slotInput(slot)] = { block: body };
    }
    out.push({
      type: blockTypeFor(card.spec),
      id: path,
      fields,
      extraState: {
        text: card.text,
        was: card.holes.map((h) => h.value),
        ...(pad.length > 0 ? { pad } : {}),
        seps: card.seps ?? {},
        // Which slots existed, so an `if` written with an empty `else` still
        // has one when it comes back.
        slots: Object.keys(card.slots ?? {}),
      },
      ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
    });
    return out;
  }

  const spec = cardSpec(card.spec);
  if (!spec) {
    // A placeholder card exists only to carry a trailing run of blank lines,
    // and there is nothing to draw for it.
    if (card.text === "") return out;
    out.push({
      type: RAW_BLOCK,
      id: path,
      fields: { CODE: card.text },
      ...(pad.length > 0 ? { extraState: { pad } } : {}),
    });
    return out;
  }
  /*
   * A `value` hole is a socket, not a field.
   *
   * `set seen = 0` is a name and a thing, and the thing can be a number, a
   * property, another variable or an expression — so it is somewhere a block
   * goes rather than somewhere text is typed. Everything else stays a field:
   * a speed is a speed.
   */
  const fields: Record<string, string | number> = {};
  const valueInputs: Record<string, { block: BlockJson }> = {};
  let argCount: number | null = null;
  card.holes.forEach((hole, i) => {
    if (hole.kind === "value") {
      valueInputs[`V${i}`] = { block: valueBlock(hole.value) };
    } else if (hole.kind === "args") {
      /*
       * One socket per argument, so a `do` call is assembled the way a call
       * looks — a name and the things handed to it — rather than typed as a
       * comma-separated string. Split on top-level commas only: `do fold with
       * mx, my, number(field(event.data, 5))` is three arguments, and a naive
       * split would make it five and quietly change what the routine is
       * called with.
       */
      const args = splitArgs(hole.value);
      args.forEach((arg, n) => {
        valueInputs[`A${n}`] = { block: valueBlock(arg) };
      });
      // The count rides in `extraState`, not in a field, because the sockets
      // have to exist before Blockly connects anything to them — and
      // `loadExtraState` runs before the inputs are filled, where a field does
      // not.
      argCount = args.length;
    } else {
      fields[`V${i}`] = hole.value;
    }
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
    id: path,
    fields,
    ...(Object.keys(valueInputs).length > 0 ? { inputs: valueInputs } : {}),
    extraState: {
      text: card.text,
      was: card.holes.map((h) => h.value),
      ...(pad.length > 0 ? { pad } : {}),
      ...(argCount === null ? {} : { args: argCount }),
    },
  });
  return out;
}

function blockJsonFor(block: Block, at: number): BlockJson {
  /*
   * A trailing run of blank or comment lines has no statement to ride on, so
   * it rides on the block itself. Without somewhere to put it the lines were
   * simply lost, which is a round trip that silently eats the gap between one
   * handler and the next.
   */
  const last = block.cards[block.cards.length - 1];
  const tailPad = last && last.text === "" ? last.lead : [];
  const carried = tailPad.length > 0 ? block.cards.slice(0, -1) : block.cards;
  const body = chain(carried.flatMap((c, i) => cardBlocks(c, `h${at}.${i}.`)));

  if (block.kind === "robot") {
    /*
     * The declarations, as a hat with the globals stacked inside it.
     *
     * They were carried out of band as a run of untouched lines: they
     * round-tripped exactly, and they were invisible — `name`, `chassis` and
     * every global `var` could be read in the code tab and neither seen nor
     * changed in blocks. A block editor that cannot show a third of the file
     * is not a view of the file.
     */
    const json: BlockJson = {
      type: ROBOT_BLOCK,
      id: `h${at}`,
      extraState: { lead: block.lead, ...(tailPad.length > 0 ? { tailPad } : {}) },
    };
    if (body) json.inputs = { SETUP: { block: body } };
    return json;
  }

  const json: BlockJson = {
    type: block.kind === "can" ? CAN_BLOCK : WHEN_BLOCK,
    id: `h${at}`,
    fields:
      block.kind === "can"
        ? { NAME: block.name ?? "", GIVEN: block.event ?? "", PARAMS: joinArgs(block.params ?? []) }
        : { EVENT: block.event ?? "" },
    extraState: {
      header: block.header,
      lead: block.lead,
      close: block.close,
      ...(tailPad.length > 0 ? { tailPad } : {}),
    },
  };
  if (body) json.inputs = { DO: { block: body } };
  return json;
}

/**
 * A sketch, as a workspace.
 *
 * Block ids are derived from where the block sits — `h0.2.t1.` is the second
 * statement of the then-branch of the third statement of the first handler —
 * rather than generated. That is not tidiness: two people editing the same
 * {robot} need to be able to say "I am on *this* block" and mean the same
 * block, and Blockly's own ids are minted per workspace and would differ on
 * every peer. Derived from the script, they agree everywhere the script does.
 *
 * The head (name, chassis, colour, globals) and the tail ride in our own `rb`
 * key rather than becoming blocks. They are declarations rather than
 * behaviour, they are edited elsewhere, and modelling them as blocks would put
 * `chassis tank` on the canvas as a thing to drag.
 */
export function sketchToWorkspace(sketch: Sketch): WorkspaceJson {
  return {
    blocks: { languageVersion: 0, blocks: sketch.blocks.map(blockJsonFor) },
    rb: { head: sketch.head, tail: sketch.tail },
  };
}

/** Put back a trailing run of lines that had no statement to ride on. */
function withTailPad(cards: Card[], tailPad: string[] | undefined): Card[] {
  if (!tailPad || tailPad.length === 0) return cards;
  return [...cards, { id: `b${++counter}`, spec: "raw", holes: [], text: "", lead: tailPad }];
}

let counter = 0;

/** Write a `can` header from its parts. */
function canHeader(name: string, params: readonly string[], given: string | null): string {
  const withPart = params.length > 0 ? ` with ${joinArgs(params)}` : "";
  const givenPart = given ? ` given ${given}` : "";
  return `can ${name}${withPart}${givenPart}`;
}

/**
 * Does this header already say these things?
 *
 * Compared on the parts, through the one reader that knows the grammar, so a
 * header carrying a cadence clause nothing here models — `can scan given tick
 * every 30` — is recognised as unchanged and kept whole rather than rewritten
 * without its `every 30`. And so that a biological `given sense organism` is
 * compared as the event it names rather than as the words it is spelt with:
 * reading it here with a second regex is exactly how it came to be rewritten
 * in mechanical words.
 */
function canHeaderMatches(
  header: string,
  name: string,
  params: readonly string[],
  given: string | null,
): boolean {
  const had = parseCanHeader(header);
  return (
    had.name === name &&
    (had.given ?? null) === given &&
    had.params.length === params.length &&
    had.params.every((p, i) => p === params[i])
  );
}

/** Regenerate a construct's header line when its values have been edited. */
function nestText(spec: string, holes: { value: string }[], was?: string): string {
  const indent = was ? (/^\s*/.exec(was)?.[0] ?? "  ") : "  ";
  if (spec === "if") return `${indent}if ${holes[0]?.value ?? "1 is 1"} then`;
  if (spec === "repeat") return `${indent}repeat ${holes[0]?.value ?? "2"} times`;
  if (spec === "for") {
    return `${indent}for ${holes[0]?.value ?? "i"} = ${holes[1]?.value ?? "1"} to ${holes[2]?.value ?? "3"}`;
  }
  return `${indent}loop`;
}

/**
 * A chain of Blockly statement blocks, back into cards.
 *
 * Recursive, mirroring `cardBlocks`: a construct's statement inputs become its
 * slots, so `if` inside `loop` survives as a tree. Comments accumulate as the
 * `lead` of whatever statement follows them, which is where they were written.
 */
function readStatements(statements: BlockJson[]): Card[] {
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
      const padded = ((st.extraState ?? {}) as { pad?: string[] }).pad ?? [];
      cards.push({
        id: `b${++counter}`,
        spec: "raw",
        holes: [],
        text: String(st.fields?.["CODE"] ?? ""),
        lead: [...padded, ...lead],
      });
      lead = [];
      continue;
    }

    const specId = specIdFor(st.type);

    if (specId && isNest(specId)) {
      const kept = (st.extraState ?? {}) as {
        text?: string;
        was?: string[];
        pad?: string[];
        seps?: Record<string, string>;
        slots?: string[];
      };
      lead = [...(kept.pad ?? []), ...lead];
      const holes =
        specId === "if"
          ? [{ kind: "expr" as const, value: blockToCondition(st.inputs?.["COND"]?.block) }]
          : (kept.was ?? []).map((_, i) => ({
              kind: "expr" as const,
              value: String(st.fields?.[`V${i}`] ?? ""),
            }));
      const unchanged =
        kept.text !== undefined &&
        kept.was !== undefined &&
        kept.was.every((v, i) => v === holes[i]?.value);

      const slots: Record<string, Card[]> = {};
      for (const slot of NESTS[specId] ?? []) {
        const input = st.inputs?.[slotInput(slot)]?.block;
        /*
         * A slot that existed but is now empty must still exist. Otherwise an
         * `if` whose `else` branch was emptied loses the branch rather than
         * the lines — and `if ... else ... end` with nothing between `else` and
         * `end` is legal, where an `if` that has silently lost its `else` is a
         * different program.
         */
        if (input === undefined && !(kept.slots ?? []).includes(slot)) continue;
        slots[slot] = readStatements(unchain(input));
      }

      cards.push({
        id: `b${++counter}`,
        spec: specId,
        holes,
        text: unchanged ? kept.text! : nestText(specId, holes, kept.text),
        lead,
        slots,
        ...(kept.seps ? { seps: kept.seps } : {}),
      });
      lead = [];
      continue;
    }

    const spec = specId ? cardSpec(specId) : undefined;
    if (!spec) continue;
    const holes = spec.holes.map((h, i) => {
      if (h.kind === "value") {
        return { kind: h.kind, value: blockToCondition(st.inputs?.[`V${i}`]?.block) || h.default };
      }
      if (h.kind === "args") {
        const count = Number(((st.extraState ?? {}) as { args?: number }).args ?? 0);
        const args: string[] = [];
        for (let n = 0; n < count; n++) {
          args.push(blockToCondition(st.inputs?.[`A${n}`]?.block));
        }
        return { kind: h.kind, value: joinArgs(args) };
      }
      return { kind: h.kind, value: String(st.fields?.[`V${i}`] ?? h.default) };
    });
    const kept = (st.extraState ?? {}) as { text?: string; was?: string[]; pad?: string[] };
    lead = [...(kept.pad ?? []), ...lead];
    // Untouched means untouched: same values as it went in with, so the line
    // it came from is still the right line, in the player's own words.
    const unchanged =
      kept.text !== undefined &&
      kept.was !== undefined &&
      kept.was.length === holes.length &&
      kept.was.every((v, i) => v === holes[i]!.value);
    const indent = kept.text ? (/^\s*/.exec(kept.text)?.[0] ?? "  ") : "  ";
    cards.push({
      id: `b${++counter}`,
      spec: spec.id,
      holes,
      text: unchanged ? kept.text! : cardText(spec, holes, indent),
      lead,
    });
    lead = [];
  }

  // A run of comments with nothing after it still has to come out.
  if (lead.length > 0) {
    cards.push({ id: `b${++counter}`, spec: "raw", holes: [], text: "", lead });
  }
  return cards;
}

/** And back. */
export function workspaceToSketch(json: WorkspaceJson): Sketch {
  const blocks: Block[] = [];

  for (const hat of json.blocks?.blocks ?? []) {
    if (hat.type === ROBOT_BLOCK) {
      const extra = (hat.extraState ?? {}) as { lead?: string[]; tailPad?: string[] };
      blocks.push({
        id: `h${++counter}`,
        header: "",
        kind: "robot",
        event: null,
        cards: withTailPad(readStatements(unchain(hat.inputs?.["SETUP"]?.block)), extra.tailPad),
        lead: extra.lead ?? [],
        close: null,
      });
      continue;
    }
    if (hat.type !== WHEN_BLOCK && hat.type !== CAN_BLOCK) continue;
    const extra = (hat.extraState ?? {}) as {
      header?: string;
      lead?: string[];
      close?: string | null;
      tailPad?: string[];
    };
    const cards = withTailPad(readStatements(unchain(hat.inputs?.["DO"]?.block)), extra.tailPad);

    if (hat.type === CAN_BLOCK) {
      const name = String(hat.fields?.["NAME"] ?? "");
      const given = String(hat.fields?.["GIVEN"] ?? "") || null;
      const params = splitArgs(String(hat.fields?.["PARAMS"] ?? ""));
      // Regenerated only when something about the header actually changed, so
      // a `can` nobody touched keeps its own spacing and its cadence clause.
      const rebuilt = canHeader(name, params, given);
      const untouched = extra.header !== undefined && canHeaderMatches(extra.header, name, params, given);
      blocks.push({
        id: `h${++counter}`,
        header: untouched ? extra.header! : rebuilt,
        kind: "can",
        event: given as Block["event"],
        name,
        params,
        cards,
        lead: extra.lead ?? [],
        close: extra.close === undefined ? "end" : extra.close,
      });
      continue;
    }

    const event = String(hat.fields?.["EVENT"] ?? "") || null;
    /*
     * Follow the dropdown when it has been changed.
     *
     * The header used to be kept verbatim whatever the field said, which meant
     * the event dropdown did nothing at all: you could set a handler to
     * `hit wall`, watch the block say so, and find the script unchanged.
     * Compared against the header's own event so that a cadence clause the
     * bridge does not model — `on tick every 30` — survives untouched.
     */
    const hadEvent = extra.header ? eventOfHeader(extra.header) : null;
    const header =
      extra.header !== undefined && hadEvent === event
        ? extra.header
        : `on ${event ?? "start"}`;
    blocks.push({
      id: `h${++counter}`,
      header,
      kind: "on",
      event: (event as Block["event"]) ?? null,
      cards,
      lead: extra.lead ?? [],
      close: extra.close === undefined ? "end" : extra.close,
    });
  }

  return { head: json.rb?.head ?? [], blocks, tail: json.rb?.tail ?? [] };
}

