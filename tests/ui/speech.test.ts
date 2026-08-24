/**
 * What the helper reads out.
 *
 * The playback path needs a browser and is verified by hand; what can be
 * tested here is the part that decides what the words even are, plus the
 * promise that none of it explodes in an environment with no audio at all —
 * which is exactly the environment this test runs in.
 */

import { describe, expect, it } from "vitest";
import { Speaker, speakable, voiceSupported } from "../../src/ui/character/speech.js";
import { TOURS } from "../../src/ui/tour/steps.js";
import { fillVocab } from "../../src/learn/markdown.js";
import { BRANDING } from "../../src/ui/branding.js";
import type { Theme } from "../../src/lang/vocab.js";

describe("speakable", () => {
  it("reads code as its contents, not as punctuation", () => {
    expect(speakable("`on start` runs once")).toBe("on start runs once");
  });

  it("drops emphasis markers", () => {
    expect(speakable("Tick **Sitting Duck** and *nothing* else")).toBe(
      "Tick Sitting Duck and nothing else",
    );
    expect(speakable("_quietly_")).toBe("quietly");
  });

  it("keeps link text and drops the target", () => {
    expect(speakable("see [the reference](#/reference) for more")).toBe(
      "see the reference for more",
    );
  });

  it("never reads an unfilled placeholder aloud", () => {
    // Belt and braces: copy is filled before it gets here, but "open brace
    // robot close brace" is a bad enough thing to say that it is worth two
    // defences.
    expect(speakable("your {robot} is fine")).toBe("your is fine");
  });

  it("collapses the whitespace left behind", () => {
    expect(speakable("a  \n  b")).toBe("a b");
  });

  it("returns nothing for text that was only markup", () => {
    expect(speakable("  **  **  ")).toBe("");
  });
});

describe("every line the tours can say", () => {
  const themes: Theme[] = ["mechanical", "biological"];

  it("survives being turned into speech", () => {
    for (const step of Object.values(TOURS).flat()) {
      for (const theme of themes) {
        for (const field of [step.title, step.body]) {
          const spoken = speakable(fillVocab(field, theme));
          expect(spoken, `${step.id} (${theme})`).not.toBe("");
          // Anything left here is something a voice would mispronounce.
          expect(spoken, `${step.id} (${theme})`).not.toMatch(/[`*{}]|\[.*\]\(/);
        }
      }
    }
  });

  it("says the character's greeting without markup", () => {
    for (const theme of themes) {
      expect(speakable(BRANDING[theme].character.greeting)).not.toBe("");
    }
  });
});

describe("with no audio at all", () => {
  // Which is this test runner. The tour has to run silently rather than throw.
  it("knows it cannot speak", () => {
    expect(voiceSupported()).toBe(false);
  });

  it("reports failure to load rather than rejecting", async () => {
    const speaker = new Speaker({
      load: () => Promise.reject(new Error("no")),
      synthesise: () => Promise.reject(new Error("no")),
      dispose: () => undefined,
    });
    await expect(speaker.load()).resolves.toBe(false);
  });

  it("stays quiet and unbothered when asked to speak", async () => {
    let synthesised = 0;
    const speaker = new Speaker({
      load: () => Promise.resolve(),
      synthesise: () => {
        synthesised++;
        return Promise.reject(new Error("no engine here"));
      },
      dispose: () => undefined,
    });
    await expect(speaker.say("hello")).resolves.toBeUndefined();
    await expect(speaker.prepare("hello")).resolves.toBeUndefined();
    expect(speaker.speaking).toBe(false);
    expect(speaker.amplitude()).toBe(0);
    expect(synthesised).toBeGreaterThan(0);
    speaker.dispose();
  });

  it("does not try to synthesise an empty line", async () => {
    let synthesised = 0;
    const speaker = new Speaker({
      load: () => Promise.resolve(),
      synthesise: () => {
        synthesised++;
        return Promise.resolve(new ArrayBuffer(0));
      },
      dispose: () => undefined,
    });
    await speaker.say("****");
    expect(synthesised).toBe(0);
  });

  it("only synthesises a repeated line once", async () => {
    let synthesised = 0;
    const speaker = new Speaker({
      load: () => Promise.resolve(),
      synthesise: () => {
        synthesised++;
        return Promise.resolve(new ArrayBuffer(8));
      },
      dispose: () => undefined,
    });
    await speaker.prepare("the same line");
    await speaker.prepare("the same line");
    expect(synthesised).toBe(1);
  });
});
