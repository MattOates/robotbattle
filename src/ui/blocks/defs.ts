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
import { COMMENT_BLOCK, RAW_BLOCK, WHEN_BLOCK, blockTypeFor } from "./bridge.js";
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
};

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

  const say = (spec: CardSpec) =>
    (register === "simple" ? spec.say.simple : spec.say.full).replace(/\{0\}/g, "%1");

  for (const spec of CARDS) {
    const hole = spec.holes[0];
    Blockly.Blocks[blockTypeFor(spec.id)] = {
      init(this: Blockly.Block) {
        const message = hole ? say(spec) : say(spec).replace(/%1/g, "");
        this.appendDummyInput().appendField(`${spec.icon} `);
        if (hole) {
          const parts = message.split("%1");
          this.inputList[0]!.appendField(parts[0] ?? "");
          this.inputList[0]!.appendField(fieldFor(hole.kind, hole.default), "V0");
          if (parts[1]) this.inputList[0]!.appendField(parts[1]);
        } else {
          this.inputList[0]!.appendField(message);
        }
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

  /**
   * Anything the catalogue does not model — loops, `can` blocks, expressions.
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
  // Speed and ticks are both a number on a range, and a slider is the control
  // that cannot be wrong — there is no way to type 900 into a speed that stops
  // at 100.
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
        contents: CARDS.filter((c) => c.group === group.id).map((c) => ({
          kind: "block",
          type: blockTypeFor(c.id),
        })),
      })),
      {
        kind: "category",
        name: register === "simple" ? "Notes" : "Comments",
        colour: "0",
        contents: [{ kind: "block", type: COMMENT_BLOCK }],
      },
    ],
  };
}
