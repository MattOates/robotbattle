import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { diff, writeShared } from "../../src/ui/blocks/sharedText.js";
import { fromSource, toSource } from "../../src/workshop/compose.js";
import { sketchToWorkspace, workspaceToSketch } from "../../src/ui/blocks/bridge.js";
import { TOUR_ROBOT } from "../../src/bots/index.js";

describe("turning a regenerated script back into the edit it was", () => {
  it("finds nothing to do when nothing changed", () => {
    expect(diff("abc", "abc")).toBeNull();
  });

  it("finds an insertion, a deletion and a replacement", () => {
    expect(diff("ac", "abc")).toEqual({ at: 1, remove: 0, insert: "b" });
    expect(diff("abc", "ac")).toEqual({ at: 1, remove: 1, insert: "" });
    expect(diff("abc", "axc")).toEqual({ at: 1, remove: 1, insert: "x" });
  });

  it("always reproduces the target", () => {
    const cases: [string, string][] = [
      ["", "hello"],
      ["hello", ""],
      ["aaa", "aa"],
      ["aa", "aaa"],
      ["on start\n  drive forward 60\nend", "on start\n  drive forward 90\nend"],
    ];
    for (const [before, after] of cases) {
      const e = diff(before, after);
      const out = e
        ? before.slice(0, e.at) + e.insert + before.slice(e.at + e.remove)
        : before;
      expect(out, `${before} -> ${after}`).toBe(after);
    }
  });

  /**
   * The property the whole thing exists for. Changing one value must touch a
   * few characters, not the document — otherwise every block drag reads to the
   * CRDT as "the entire script was replaced", and two people working on
   * different handlers overwrite each other instead of merging.
   */
  it("changes only the part that changed, across a whole robot", () => {
    const before = TOUR_ROBOT;
    const ws = sketchToWorkspace(fromSource(before));
    // Reach into one statement, the way moving a slider would.
    const hat = ws.blocks!.blocks.find((b) => b.type === "rb_when")!;
    hat.inputs!["DO"]!.block.next!.block.fields!["V0"] = "10";
    const after = toSource(workspaceToSketch(ws));

    expect(after).not.toBe(before);
    const edit = diff(before, after)!;
    expect(edit.remove).toBeLessThan(40);
    expect(edit.insert.length).toBeLessThan(40);
  });
});

describe("writing into a real shared document", () => {
  it("applies as one edit and reads back", () => {
    const doc = new Y.Doc();
    const text = doc.getText("robot");
    text.insert(0, TOUR_ROBOT);

    let updates = 0;
    doc.on("update", () => updates++);

    const next = TOUR_ROBOT.replace("drive forward 60", "drive forward 90");
    expect(writeShared(text, next)).toBe(true);
    expect(text.toString()).toBe(next);
    // One transaction, so a peer never renders the document mid-replacement.
    expect(updates).toBe(1);
  });

  it("does nothing when the script is unchanged", () => {
    const doc = new Y.Doc();
    const text = doc.getText("robot");
    text.insert(0, TOUR_ROBOT);
    let updates = 0;
    doc.on("update", () => updates++);
    expect(writeShared(text, TOUR_ROBOT)).toBe(false);
    expect(updates).toBe(0);
  });

  /**
   * Two peers, two handlers, one merge. This is what a full-document replace
   * would get wrong: whoever wrote second would win outright.
   */
  it("merges two people editing different parts", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const start = 'name "X"\nchassis tank\n\non start\n  drive forward 60\nend\n\non hit wall\n  turn body by 150\nend\n';
    a.getText("r").insert(0, start);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    writeShared(a.getText("r"), start.replace("drive forward 60", "drive forward 90"));
    writeShared(b.getText("r"), start.replace("turn body by 150", "turn body by 90"));

    const updateA = Y.encodeStateAsUpdate(a);
    const updateB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, updateB);
    Y.applyUpdate(b, updateA);

    // Both edits survive, on both peers.
    for (const doc of [a, b]) {
      const out = doc.getText("r").toString();
      expect(out).toContain("drive forward 90");
      expect(out).toContain("turn body by 90");
    }
    expect(a.getText("r").toString()).toBe(b.getText("r").toString());
  });
});
