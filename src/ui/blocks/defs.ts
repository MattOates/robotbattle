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
  CAN_BLOCK,
  COMMENT_BLOCK,
  COMPARE_BLOCK,
  COMPARISONS,
  EXPR_BLOCK,
  NUM_BLOCK,
  PROP_BLOCK,
  VAR_BLOCK,
  RAW_BLOCK,
  ROBOT_BLOCK,
  WHEN_BLOCK,
  blockTypeFor,
} from "./bridge.js";
import { EVENT_DOCS } from "../../lang/events.js";
import { EVENT_NAMES, type EventName } from "../../lang/ast.js";
import { fillVocab } from "../../learn/markdown.js";
import { phraseFor, type Theme } from "../../lang/vocab.js";

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
  do: 260,
  robot: 30,
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
/** The palette category for the behaviours a script has named. */
export const ROUTINE_CATEGORY = "RB_ROUTINES";

/** The `can` blocks the open script declares, with how many arguments each takes. */
let knownRoutines: readonly { name: string; args: number }[] = [];

export function setKnownRoutines(routines: readonly { name: string; args: number }[]): void {
  knownRoutines = routines;
}

/**
 * The Do category, worked out when it is opened.
 *
 * One call block per behaviour the script has named, each already carrying the
 * right number of argument sockets — because "how many does this one take" is
 * a thing the script knows and the person calling it should not have to.
 */
export function routineFlyout(): Blockly.utils.toolbox.FlyoutItemInfoArray {
  return [
    { kind: "block", type: CAN_BLOCK },
    ...knownRoutines.map((routine) =>
      routine.args === 0
        ? { kind: "block", type: blockTypeFor("do"), fields: { V0: routine.name } }
        : {
            kind: "block",
            type: blockTypeFor("do-with"),
            fields: { V0: routine.name, ARGC: routine.args },
          },
    ),
  ] as Blockly.utils.toolbox.FlyoutItemInfoArray;
}

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
        // Filled, not raw: these carry `{turret}`, `{Fire}` and `{radar}`, and
        // without this the blocks read "Point the {turret} at" — the braces on
        // screen, and the biological words never reached at all.
        const phrase = fillVocab(register === "simple" ? spec.say.simple : spec.say.full, theme);
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
          if (hole.kind === "args") {
            // A hidden count rather than a visible control: the number of
            // arguments is decided by the routine, not by the caller.
            input.appendField(new Blockly.FieldNumber(0, 0, 8, 1), "ARGC");
            this.getField("ARGC")?.setVisible(false);
          } else if (hole.kind === "value") {
            input = this.appendValueInput(`V${at}`);
          } else {
            input.appendField(fieldFor(hole.kind, hole.default), `V${at}`);
          }
        }

        /*
         * A `do` call grows one socket per argument.
         *
         * The count is not fixed by the block type — it is fixed by the
         * routine being called — so the block reads it from its own state and
         * builds itself. `ARGC` travels in the serialised fields, which is why
         * a call loaded from a script comes back with the right shape.
         */
        if (spec.holes.some((h) => h.kind === "args")) {
          const count = Number(this.getFieldValue("ARGC") ?? 0);
          for (let n = 0; n < count; n++) {
            this.appendValueInput(`A${n}`).appendField(n === 0 ? "" : "and");
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
          /*
           * Every event, not the offered few.
           *
           * The palette offers six because six is what a first {robot} is
           * built from. The *field* has to hold whatever the script says, and
           * a dropdown that cannot hold its value falls back to the first
           * option — `on ping robot` was drawn as "start", which is a lie
           * about somebody's {robot} and the same bug the angles had.
           */
          openDropdown(EVENT_NAMES.map((e) => [phraseFor(e, theme), e] as [string, string])),
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
   * The declarations at the top of the file.
   *
   * A hat with the name, the chassis and the colour on it, and the globals
   * stacked inside — because a global is the only kind of variable that
   * survives between events, and where it is declared is the difference. They
   * were carried as untouched lines before: they round-tripped perfectly and
   * were invisible, so a third of every script could be read in code and
   * neither seen nor changed in blocks.
   */
  Blockly.Blocks[ROBOT_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(`🤖 ${fillVocab("This {robot}", theme)}`);
      this.appendStatementInput("SETUP");
      this.setColour(GROUP_HUE.robot);
      this.setTooltip(
        "What this {robot} is, and the things it remembers for the whole match.",
      );
      // There is exactly one, and it is not a thing you delete or duplicate.
      this.setDeletable(false);
      this.setMovable(true);
    },
  };

  /**
   * A named behaviour.
   *
   * The thing worth handing to somebody else, and the reason it is worth
   * handing over is `given`: it says which event the body may read through
   * `event.*`, so the compiler can refuse it anywhere it would not make sense.
   * The name is typed because it is the author's own word; everything else is
   * chosen, because everything else has a fixed set of right answers.
   */
  Blockly.Blocks[CAN_BLOCK] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField("🧩 to")
        .appendField(new Blockly.FieldTextInput("dodge"), "NAME")
        .appendField("with")
        .appendField(new Blockly.FieldTextInput(""), "PARAMS")
        .appendField("when")
        .appendField(
          openDropdown([
            ["anything", ""],
            ...OFFERED_EVENTS.map((e) => [phraseFor(e, theme), e] as [string, string]),
          ]),
          "GIVEN",
        );
      this.appendStatementInput("DO");
      this.setColour(285);
      this.setTooltip(
        "A behaviour with a name. `given` says which event it works on, which is what makes it safe to give away.",
      );
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
        openDropdown(PROP_CHOICES),
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
        // The same open dropdown, over whatever the script has declared.
        (new OpenDropdown(function (this: Blockly.FieldDropdown) {
          const current = String(this.getValue() ?? "");
          const known = knownVariables.map((n) => [n, n] as [string, string]);
          if (current !== "" && !knownVariables.includes(current)) {
            known.unshift([current, current]);
          }
          return known.length > 0 ? known : [["seen", "seen"]];
        }) as unknown as Blockly.Field),
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

/**
 * A dropdown that cannot lose the value it was given.
 *
 * Blockly falls back to the first option when a field holds something the list
 * does not offer — so `turn body by 150`, whose 150 is not one of the named
 * angles, rendered as "at them" and would have been *written back* as
 * `event.bearing`. A dropdown silently rewriting somebody's {robot} is the
 * worst bug this editor could have, and it is the same one the card view
 * already guards against.
 *
 * So whatever the field holds is always an option, listed first.
 */
class OpenDropdown extends Blockly.FieldDropdown {
  /**
   * Accept the value, whatever it is.
   *
   * `FieldDropdown` validates against its option list and falls back to the
   * first option when the value is not in it. A generator that adds the
   * current value cannot save it either, because the generator runs before the
   * value has been set — so `turn body by 150` was validated against a list
   * built for the *default* value, rejected, and silently became
   * `event.bearing`. This is the only place that can know the difference
   * between "not one of the names we offer" and "not allowed".
   */
  protected override doClassValidation_(value?: unknown): string | null {
    return value === undefined || value === null ? null : String(value);
  }

  /**
   * Show the value when there is no name for it.
   *
   * `FieldDropdown` renders the label of its cached selected option, and the
   * cache is built when the field is constructed — before the block's value
   * arrives from the script. So a value with no matching option kept the
   * *default* option's label: `turn body by 150` was drawn as "at them", which
   * is a lie about somebody's {robot} even though the script underneath was
   * still correct. Looked up fresh here, and falling back to the value itself,
   * which is the honest thing to show for a number nobody has named.
   */
  protected override getText_(): string {
    const value = String(this.getValue() ?? "");
    const options = this.getOptions(false);
    for (const [label, optionValue] of options) {
      if (optionValue === value) return typeof label === "string" ? label : value;
    }
    return value;
  }
}

function openDropdown(choices: readonly (readonly [string, string])[]): Blockly.Field {
  // `exactOptionalPropertyTypes` makes the subclass structurally incompatible
  // with `Field<unknown>` over an optional `validator_`. It is a Field.
  return new OpenDropdown(function (this: Blockly.FieldDropdown) {
    const current = String(this.getValue() ?? "");
    const known = choices.map((c) => [...c] as [string, string]);
    if (current !== "" && !known.some(([, value]) => value === current)) {
      known.unshift([current, current]);
    }
    return known;
  }) as unknown as Blockly.Field;
}

/** The control for one kind of value. */
function fieldFor(kind: string, initial: string): Blockly.Field {
  if (kind === "angle") {
    return openDropdown(ANGLE_CHOICES.map((c) => [c.say, c.value] as [string, string]));
  }
  if (kind === "power") {
    return openDropdown([
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
        name: register === "simple" ? "This robot" : "Robot",
        colour: String(GROUP_HUE.robot),
        contents: CARDS.filter((c) => c.group === "robot").map((c) => ({
          kind: "block",
          type: blockTypeFor(c.id),
        })),
      },
      {
        kind: "category",
        name: register === "simple" ? "Your bits" : "Behaviours",
        colour: String(GROUP_HUE.do),
        custom: ROUTINE_CATEGORY,
      },
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
