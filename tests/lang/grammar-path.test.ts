/**
 * Walking the grammar to work out what can come next.
 *
 * Two things read this: the guide under the editor and the completion popup.
 * They used to answer separately, and the popup's answer was a hand-written
 * transcription of the action grammar that could disagree with the parser
 * without anything noticing. So the bar here is not "gives a plausible list" —
 * it is "gives the list the parser would actually accept", which is what the
 * last block of tests checks by compiling every suggestion.
 */

import { describe, expect, it } from "vitest";
import { LITERAL, pathFrom } from "../../src/lang/grammar-path.js";
import { pathAt } from "../../src/lang/complete.js";
import { checkScript } from "../../src/sim/world.js";

/** `pathFrom` on a statement, from words written the way the scanner does. */
const after = (...words: string[]) => pathFrom("statement", words);
const atTop = (...words: string[]) => pathFrom("topLevel", words);

describe("what can come next", () => {
  it("offers the instructions at the start of a line", () => {
    const path = after()!;
    expect(path.words).toContain("drive");
    expect(path.words).toContain("turn");
    expect(path.words).toContain("if");
    expect(path.words).toContain("wait");
  });

  it("knows `turn` needs a direction word", () => {
    expect(after("turn")!.words.sort()).toEqual(["by", "chassis", "to"]);
  });

  it("knows what comes after `turn chassis`", () => {
    expect(after("turn", "chassis")!.words.sort()).toEqual(["by", "to"]);
  });

  it("wants a value after `turn to`", () => {
    const path = after("turn", "to")!;
    expect(path.wantsValue).toBe(true);
    expect(path.words).toEqual([]);
  });

  it("knows `drive` takes a direction or goes straight to a value", () => {
    const path = after("drive")!;
    // `backward` is the same word as `back`, folded by the lexer, so it is not
    // offered twice.
    expect(path.words.sort()).toEqual(["back", "forward"]);
    expect(path.wantsValue).toBe(true);
  });

  it("offers the three things a turret can do", () => {
    expect(after("turret", ".")!.words.sort()).toEqual(["aim", "fire", "sweep", "turn"]);
  });

  it("offers the four things a radar can do", () => {
    expect(after("radar", ".")!.words.sort()).toEqual(["aim", "ping", "sweep", "turn"]);
  });

  it("treats `at` after `aim` as optional decoration", () => {
    const path = after("turret", ".", "aim")!;
    expect(path.words).toEqual(["at"]);
    expect(path.wantsValue).toBe(true);
  });
});

describe("values", () => {
  it("carries on past a value to what follows it", () => {
    // `wait <value> ticks` — the words after the number are still offered.
    expect(after("wait", LITERAL)!.words.sort()).toEqual(["tick", "ticks"]);
  });

  it("does the same for `repeat`", () => {
    expect(after("repeat", LITERAL)!.words).toEqual(["times"]);
  });

  it("steps over a value made of several words", () => {
    expect(after("wait", "me", ".", "speed")!.words.sort()).toEqual(["tick", "ticks"]);
  });

  it("steps over a value with brackets and commas in it", () => {
    const path = after("wait", "min", "(", LITERAL, ",", LITERAL, ")")!;
    expect(path.words.sort()).toEqual(["tick", "ticks"]);
  });

  it("does not let a comma outside brackets run the values together", () => {
    // `do shove with 2, 3` is two values, and the second is still a value.
    expect(pathFrom("statement", ["do", "shove", "with", LITERAL, ",", LITERAL])).not.toBeNull();
  });
});

describe("finished and unfinished lines", () => {
  it("says a bare `fire` is a whole instruction", () => {
    expect(after("fire")!.complete).toBe(true);
  });

  it("says `turn` on its own is not", () => {
    expect(after("turn")!.complete).toBe(false);
  });

  it("returns nothing at all for a line the language cannot read", () => {
    expect(after("wibble", "wobble")).toBeNull();
  });
});

describe("the top level", () => {
  it("offers the declarations and the two block words", () => {
    const path = atTop()!;
    for (const word of ["name", "chassis", "color", "var", "on", "can"]) {
      expect(path.words, word).toContain(word);
    }
  });

  it("offers the two bodies after `chassis`", () => {
    expect(atTop("chassis")!.words.sort()).toEqual(["skid", "steered"]);
  });

  it("wants a piece of text after `name`", () => {
    const path = atTop("name")!;
    expect(path.words).toEqual([]);
    expect(path.next.size).toBe(1);
  });
});

describe("marking the diagram", () => {
  it("lights the words that were matched", () => {
    const path = after("turn", "chassis")!;
    const lit = [...path.done]
      .map((n) => (n.kind === "word" ? n.text : "?"))
      .sort();
    expect(lit).toEqual(["chassis", "turn"]);
  });

  it("does not light what has not been typed", () => {
    const path = after("turn")!;
    expect([...path.done].map((n) => (n.kind === "word" ? n.text : "?"))).toEqual(["turn"]);
  });
});

describe("everything it offers actually compiles", () => {
  /**
   * The point of the whole exercise. A suggestion that does not parse is worse
   * than no suggestion: a beginner takes it, it fails, and they conclude they
   * cannot read.
   */
  const starts = [
    [],
    ["turn"],
    ["turn", "chassis"],
    ["drive"],
    ["turret", "."],
    ["radar", "."],
    ["turret", ".", "aim"],
    ["set"],
    ["if"],
    ["loop"],
  ];

  it.each(starts.map((s) => [s.join(" ") || "(nothing typed)", s] as const))(
    "after `%s`",
    (_label, typed) => {
      const path = pathFrom("statement", typed);
      expect(path).not.toBeNull();
      for (const word of path!.words) {
        // The smallest whole script that puts these words inside a block.
        const line = [...typed, word].join(" ").replace(/ \. /g, ".");
        const script = `name "x"\nchassis tank\non tick\n  ${line}\nend\n`;
        // Many of these are prefixes rather than whole instructions, so an
        // "unfinished line" complaint is expected and fine. What must never
        // happen is the parser rejecting the suggested word itself.
        const message = checkScript(script).error?.message ?? "";
        for (const rejection of [
          `I don't know how to \`${word}\``,
          `\`${word}\` isn't a body I know about`,
          `I don't know what \`${word}\` means`,
          `I don't know how to \`${word}\` a turret`,
          `I don't know how to \`${word}\` a radar`,
        ]) {
          expect(message, line).not.toContain(rejection);
        }
      }
    },
  );
});

describe("where a word the reader picks should go", () => {
  /**
   * The guide and the popup both offer words, and both have to replace the word
   * being typed rather than add to it. Half-way through `chas` the words offered
   * are alternatives to it, so inserting at the cursor leaves `chaschassis` —
   * and it is `pathAt` that decided `chas` was unfinished in the first place.
   */
  const H = 'name "x"\nchassis tank\n';

  it("points at the start of a part-written word", () => {
    const src = `${H}on tick\n  tur`;
    expect(pathAt(src, src.length)?.from).toBe(src.length - 3);
  });

  it("points at the cursor when there is no word under it", () => {
    const src = `${H}on tick\n  turn `;
    expect(pathAt(src, src.length)?.from).toBe(src.length);
  });

  it("treats a finished word with no space after it as still being typed", () => {
    // Which is why replacing matters: `turn chassis` with the cursor at the end
    // offers `chassis` itself among the alternatives.
    const src = `${H}on tick\n  turn chassis`;
    const path = pathAt(src, src.length)!;
    expect(path.from).toBe(src.length - "chassis".length);
    expect(path.words).toContain("chassis");
  });

  it("has committed the word once a space follows it", () => {
    const src = `${H}on tick\n  turn chassis `;
    const path = pathAt(src, src.length)!;
    expect(path.from).toBe(src.length);
    expect(path.words.sort()).toEqual(["by", "to"]);
  });
});

describe("the span a picked word replaces", () => {
  /**
   * Both ends matter, and each was wrong in turn. Replacing from the cursor
   * leaves the front of the word; replacing to the cursor leaves the back of
   * it, and `for|ward` with `back` picked spells `backward` — a real
   * instruction, so nothing downstream complains.
   */
  const H = 'name "x"\nchassis tank\n';
  const line = `${H}on tick\n  drive forward 60\nend\n`;

  /** What the document becomes when `word` is picked at `pos`. */
  const pick = (source: string, pos: number, word: string): string => {
    const path = pathAt(source, pos)!;
    return source.slice(0, path.from) + word + source.slice(path.to);
  };

  it("covers the whole word when the cursor is inside it", () => {
    const at = line.indexOf("forward") + 3;
    expect(pick(line, at, "back")).toContain("drive back 60");
  });

  it("covers it from the very start", () => {
    const at = line.indexOf("forward");
    expect(pick(line, at, "back")).toContain("drive back 60");
  });

  it("covers it from the very end", () => {
    const at = line.indexOf("forward") + "forward".length;
    expect(pick(line, at, "back")).toContain("drive back 60");
  });

  it("leaves what follows the word alone", () => {
    const at = line.indexOf("forward") + 3;
    expect(pick(line, at, "back")).toContain("60\nend");
  });

  it("replaces nothing when the cursor is on a space", () => {
    const src = `${H}on tick\n  drive `;
    const path = pathAt(src, src.length)!;
    expect(path.from).toBe(src.length);
    expect(path.to).toBe(src.length);
  });
});
