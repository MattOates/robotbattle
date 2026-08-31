/**
 * The block definitions, generated from the card catalogue.
 *
 * One table of what a {robot} can be made of — `CARDS` in
 * `workshop/compose.ts` — and three ways of showing it. Adding a card here
 * adds a block, with its phrase, its icon and its value controls already
 * decided. There is no second list to keep in step.
 *
 * The controls are the ones the card view uses, in Blockly's own field types,
 * because they were the point of the card view: a slider for a speed, a set of
 * shells for firing power, and a dropdown of *phrases* for an angle, so that
 * `event.bearing` reads as "at them" rather than as something to be guessed.
 * A number typed into a box is the thing all three views exist to avoid.
 */

import * as Blockly from "blockly/core";
/*
 * `blockly/core` ships no strings at all — the message table is a separate
 * module — and without it `inject` throws inside its own ARIA labelling before
 * ever drawing anything. Imported here rather than in the component so it is
 * loaded exactly once, alongside the blocks it labels.
 */
import * as En from "blockly/msg/en";
import { FieldSlider } from "@blockly/field-slider";

Blockly.setLocale(En as unknown as Record<string, string>);
import { ANGLE_CHOICES, CARDS, type CardSpec } from "../../workshop/compose.js";
import {
  COMMENT_BLOCK,
  COMPARE_BLOCK,
  COMPARISONS,
  EXPR_BLOCK,
  NUM_BLOCK,
  PROP_BLOCK,
  VAR_BLOCK,
  RAW_BLOCK,
  WHEN_BLOCK,
  blockTypeFor,
} from "./bridge.js";
import { EVENT_DOCS } from "../../lang/events.js";
import { phraseFor, type Theme } from "../../lang/vocab.js";
import type { EventName } from "../../lang/ast.js";

/** Which events a new hat block may be set to. Matches the card composer's. */
export const OFFERED_EVENTS: readonly EventName[] = [
  "start",
  "sense robot",
  "hit by bullet",
  "hit wall",
  "tick",
  "sense fuel",
];

/**
 * Colours by group, in the instrument's own hues rather than Blockly's
 * defaults, so the block editor reads as part of this game rather than as a
 * window into another one.
 */
const GROUP_HUE: Record<CardSpec["group"], number> = {
  move: 205,
  look: 165,
  shoot: 20,
  wait: 280,
  remember: 330,
  repeat: 120,
};

/**
 * Comparisons in words.
 *
 * `isnt` and `<=` are punctuation to somebody who already knows them and
 * hieroglyphs to somebody who does not. The block says what it means; the
 * script it writes still says `<=`.
 */
const OP_WORDS: Record<string, string> = {
  is: "is",
  isnt: "is not",
  "<": "is less than",
  ">": "is more than",
  "<=": "is at most",
  ">=": "is at least",
};

/**
 * What a condition can ask about.
 *
 * The properties a first robot actually reads, in plain words, rather than the
 * whole table — `me.gunHeat` is real and is not what a nine-year-old is
 * wondering about. Anything outside this list still arrives from the script as
 * its own name and is shown as written.
 */
const PROP_CHOICES: readonly (readonly [string, string])[] = [
  ["how far away they are", "event.distance"],
  ["which way they are", "event.bearing"],
  ["how strong I am", "me.health"],
  ["how much fuel I have", "me.fuel"],
  ["how fast I am going", "me.speed"],
  ["which way I am facing", "me.heading"],
  ["how long the fight has run", "arena.time"],
  ["how many are left", "arena.robots"],
];

/**
 * The variables the open script declares.
 *
 * Module level because Blockly's dropdown generators and toolbox callbacks are
 * plain functions with no context to thread this through, and there is exactly
 * one block editor on screen at a time. `setKnownVariables` is called whenever
 * the script changes.
 */
let knownVariables: readonly string[] = [];

export function setKnownVariables(names: readonly string[]): void {
  knownVariables = names;
}

/** The palette category name for the variables a script has made. */
export const VARIABLE_CATEGORY = "RB_VARIABLES";

/**
 * The contents of the Remember category, worked out when it is opened.
 *
 * A variable you have made should be something you can pick up and drop into a
 * socket — which is what "the variables you defined do not appear as a
 * draggable value" means. Blockly recomputes a `custom` category every time
 * the flyout opens, so declaring one and immediately reaching for it works.
 */
export function variableFlyout(): Blockly.utils.toolbox.FlyoutItemInfoArray {
  return [
    { kind: "block", type: blockTypeFor("var") },
    { kind: "block", type: blockTypeFor("set") },
    ...knownVariables.map((name) => ({
      kind: "block",
      type: VAR_BLOCK,
      fields: { NAME: name },
    })),
  ] as Blockly.utils.toolbox.FlyoutItemInfoArray;
}

let defined = false;

/**
 * Define every block, once.
 *
 * Blockly's registry is global and throws on a duplicate, which React's strict
 * mode double-mount would otherwise trigger on the first render in
 * development.
 */
export function defineBlocks(theme: Theme, register: "simple" | "full"): void {
  if (defined) return;
  defined = true;

  for (const spec of CARDS) {
    Blockly.Blocks[blockTypeFor(spec.id)] = {
      init(this: Blockly.Block) {
        /*
         * The phrase, with each `{n}` replaced by the control for that hole.
         *
         * A `value` hole becomes a *socket* — somewhere a round block goes —
         * because what it holds may be a number, a property, another variable
         * or a whole expression, and those are all the same kind of thing.
         * Everything else is a field on the block itself: a speed is a speed.
         */
        const phrase = register === "simple" ? spec.say.simple : spec.say.full;
        const parts = phrase.split(/(\{\d\})/);
        let input: Blockly.Input = this.appendDummyInput().appendField(`${spec.icon} `);

        for (const part of parts) {
          const slot = /^\{(\d)\}$/.exec(part);
          if (!slot) {
            if (part !== "") input.appendField(part);
            continue;
          }
          const at = Number(slot[1]);
          const hole = spec.holes[at];
          if (!hole) continue;
          if (hole.kind === "value") {
            input = this.appendValueInput(`V${at}`);
          } else {
            input.appendField(fieldFor(hole.kind, hole.default), `V${at}`);
          }
        }

        /*
         * Any hole the phrase forgot to place goes on the end.
         *
         * Belt and braces, and it was earned: the simple register's phrases
         * were written before the holes were placed by `{n}` — "Point at
         * them" rather than "Point at {0}" — so a placeholder-driven build
         * silently dropped the control *and* the field, which loses the value
         * on the way back. A block must always be able to show everything it
         * carries.
         */
        for (let at = 0; at < spec.holes.length; at++) {
          if (this.getField(`V${at}`) || this.getInput(`V${at}`)) continue;
          const hole = spec.holes[at]!;
          if (hole.kind === "value") this.appendValueInput(`V${at}`);
          else input.appendField(fieldFor(hole.kind, hole.default), `V${at}`);
        }

        this.setInputsInline(true);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(GROUP_HUE[spec.group]);
      },
    };
  }

  /**
   * The hat. One per event, and the event is a dropdown on the block rather
   * than a separate block type, so changing "when I see somebody" to "when I
   * am hit" does not mean rebuilding what is inside it.
   */
  Blockly.Blocks[WHEN_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField("when ")
        .appendField(
          new Blockly.FieldDropdown(
            OFFERED_EVENTS.map((e) => [phraseFor(e, theme), e] as [string, string]),
          ),
          "EVENT",
        );
      this.appendStatementInput("DO");
      this.setColour(45);
      this.setTooltip(() => {
        const event = this.getFieldValue("EVENT") as EventName;
        return EVENT_DOCS[event]?.summary ?? "";
      });
    },
  };

  /**
   * A run of comments, as a block.
   *
   * The whole reason it exists: Blockly regenerates code from the workspace,
   * so anything with no block is gone the first time somebody drags something
   * — and what would go is the author's explanation of what their {robot}
   * does, which is most of what makes a traded {robot} worth having.
   */
  Blockly.Blocks[COMMENT_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField("💬 ")
        .appendField(new Blockly.FieldTextInput(""), "TEXT");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(0);
      this.setTooltip("A note. It does not do anything — it explains.");
    },
  };

  /*
   * Deciding and repeating.
   *
   * These are the language rather than an extra, which is why they are real
   * blocks with real statement inputs: a block editor that could not express
   * `if` would not be the language as blocks, it would be a list of actions.
   * `if` takes its condition in a socket, so it is assembled rather than
   * typed; `repeat` and `for` take counts as plain fields, because a number of
   * times is a number and not a question.
   */
  Blockly.Blocks[blockTypeFor("if")] = {
    init(this: Blockly.Block) {
      this.appendValueInput("COND").appendField("🔀 if");
      this.appendStatementInput("THEN").appendField("then");
      this.appendStatementInput("ELSE").appendField("else");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(60);
    },
  };

  Blockly.Blocks[blockTypeFor("loop")] = {
    init(this: Blockly.Block) {
      this.appendStatementInput("BODY").appendField("🔁 keep doing");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(GROUP_HUE.repeat);
    },
  };

  Blockly.Blocks[blockTypeFor("repeat")] = {
    init(this: Blockly.Block) {
      this.appendStatementInput("BODY")
        .appendField("🔁 repeat")
        .appendField(new FieldSlider(2, 1, 20, 1), "V0")
        .appendField("times");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(GROUP_HUE.repeat);
    },
  };

  Blockly.Blocks[blockTypeFor("for")] = {
    init(this: Blockly.Block) {
      this.appendStatementInput("BODY")
        .appendField("🔢 count")
        .appendField(new Blockly.FieldTextInput("i"), "V0")
        .appendField("from")
        .appendField(new Blockly.FieldTextInput("1"), "V1")
        .appendField("to")
        .appendField(new Blockly.FieldTextInput("3"), "V2");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(GROUP_HUE.repeat);
    },
  };

  /*
   * The condition sockets. A comparison of two things, where each thing is a
   * property or a number — which is the shape almost every condition in a real
   * script has. Anything past that is one text block holding the expression as
   * written, so nothing is lost and nothing is silently rewritten.
   */
  Blockly.Blocks[COMPARE_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendValueInput("A");
      this.appendValueInput("B").appendField(
        new Blockly.FieldDropdown(COMPARISONS.map((op) => [OP_WORDS[op] ?? op, op])),
        "OP",
      );
      this.setInputsInline(true);
      this.setOutput(true, null);
      this.setColour(60);
    },
  };

  Blockly.Blocks[PROP_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(
        // A property the script names but this list does not is added as
        // itself, so a condition read out of somebody else's robot still
        // shows what it asks about rather than snapping to the nearest thing.
        new Blockly.FieldDropdown(function (this: Blockly.FieldDropdown) {
          const current = this.getValue();
          const known = PROP_CHOICES.map((c) => [...c] as [string, string]);
          return known.some(([, v]) => v === current) || !current
            ? known
            : [[current, current] as [string, string], ...known];
        }),
        "PROP",
      );
      this.setOutput(true, null);
      this.setColour(180);
    },
  };

  /*
   * A variable, as the same round shape as a number or a property.
   *
   * They are the same kind of thing — something you can drop into a socket —
   * and drawing them differently would be saying they are not. It also fixes
   * a real confusion: anything that was not a number used to become a
   * *property* block, so `seen`, an ordinary variable somebody declared, was
   * offered as though the world reported it like `me.health`.
   */
  Blockly.Blocks[VAR_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(
        /*
         * The variables the script has actually declared, not a text box.
         *
         * A name typed here that nothing declares is a compile error the child
         * did not write and cannot read. Whatever the block already holds is
         * always offered too, so a variable read out of somebody else's
         * {robot} still shows its own name rather than snapping to one of
         * ours.
         */
        new Blockly.FieldDropdown(function (this: Blockly.FieldDropdown) {
          const current = String(this.getValue() ?? "");
          const known = knownVariables.map((n) => [n, n] as [string, string]);
          if (current !== "" && !knownVariables.includes(current)) {
            known.unshift([current, current]);
          }
          return known.length > 0 ? known : [["seen", "seen"]];
        }),
        "NAME",
      );
      this.setOutput(true, null);
      this.setColour(GROUP_HUE.remember);
      this.setTooltip("Something your {robot} is remembering.");
    },
  };

  Blockly.Blocks[NUM_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(new Blockly.FieldNumber(0), "NUM");
      this.setOutput(true, null);
      this.setColour(180);
    },
  };

  Blockly.Blocks[EXPR_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField("⌨ ")
        .appendField(new Blockly.FieldLabelSerializable(""), "TEXT");
      this.setOutput(true, null);
      this.setColour(0);
      this.setEditable(false);
      this.setTooltip("Written by hand. Open the Code tab to change this.");
    },
  };

  /**
   * Anything the catalogue does not model — `can` blocks, `do`, calls.
   * Shown as its own code and not editable, so it is never lost and never
   * quietly rewritten.
   */
  Blockly.Blocks[RAW_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField("⌨ ")
        .appendField(new Blockly.FieldLabelSerializable(""), "CODE");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(0);
      this.setEditable(false);
      this.setTooltip("Written by hand. Open the Code tab to change this.");
    },
  };
}

/** The control for one kind of value. */
function fieldFor(kind: string, initial: string): Blockly.Field {
  if (kind === "angle") {
    return new Blockly.FieldDropdown(
      ANGLE_CHOICES.map((c) => [c.say, c.value] as [string, string]),
    );
  }
  if (kind === "power") {
    return new Blockly.FieldDropdown([
      ["●", "1"],
      ["●●", "2"],
      ["●●●", "3"],
    ]);
  }
  /*
   * Anything that is not a number on a range is text.
   *
   * `set seen = seen + 1` is an assignment, not a quantity, and running it
   * through the slider below turned it into `Number(...) || 0` — the block
   * read "Remember 0" and would have written that back. Only speeds and counts
   * get a slider, because only they have a floor and a ceiling.
   */
  if (kind !== "speed" && kind !== "ticks") {
    return new Blockly.FieldTextInput(initial);
  }

  // A slider is the control that cannot be wrong: there is no way to put 900
  // into a speed that stops at 100.
  const max = kind === "speed" ? 100 : 60;
  return new FieldSlider(Number(initial) || 0, 0, max, kind === "speed" ? 10 : 5);
}

/** The palette, grouped the way the card view groups it. */
export function toolboxFor(register: "simple" | "full"): Blockly.utils.toolbox.ToolboxDefinition {
  const groups: { id: CardSpec["group"]; label: string }[] = [
    { id: "move", label: "Move" },
    { id: "look", label: "Look" },
    { id: "shoot", label: "Shoot" },
    { id: "wait", label: "Wait" },

    { id: "repeat", label: register === "simple" ? "Again" : "Loops" },
  ];
  return {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category",
        name: "When",
        colour: "45",
        contents: [{ kind: "block", type: WHEN_BLOCK }],
      },
      ...groups.map((group) => ({
        kind: "category",
        name: group.label,
        colour: String(GROUP_HUE[group.id]),
        contents: [
          // The loop constructs live with the statements that only work
          // inside one, so `break` is never offered far from something to
          // break out of.
          ...(group.id === "repeat"
            ? [
                { kind: "block", type: blockTypeFor("loop") },
                { kind: "block", type: blockTypeFor("repeat") },
                { kind: "block", type: blockTypeFor("for") },
              ]
            : []),
          ...CARDS.filter((c) => c.group === group.id).map((c) => ({
            kind: "block",
            type: blockTypeFor(c.id),
          })),
        ],
      })),
      {
        kind: "category",
        name: register === "simple" ? "Remember" : "Variables",
        colour: String(GROUP_HUE.remember),
        // Worked out when opened, so a variable made a moment ago is there.
        custom: VARIABLE_CATEGORY,
      },
      {
        kind: "category",
        name: register === "simple" ? "Choose" : "Logic",
        colour: "60",
        contents: [
          { kind: "block", type: blockTypeFor("if") },
          { kind: "block", type: COMPARE_BLOCK },
          { kind: "block", type: PROP_BLOCK },
          { kind: "block", type: VAR_BLOCK },
          { kind: "block", type: NUM_BLOCK },
        ],
      },
      {
        kind: "category",
        name: register === "simple" ? "Notes" : "Comments",
        colour: "0",
        contents: [{ kind: "block", type: COMMENT_BLOCK }],
      },
    ],
  };
}
