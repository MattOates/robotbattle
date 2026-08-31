/**
 * The Blockly workspace, as a third way of writing a {robot}.
 *
 * Same contract as the card composer: it renders the script and hands back new
 * source text through the same `onSource` the editor uses, so lint, compile,
 * trials, version history and the shared document are unaware of it. The
 * mapping both ways is in `bridge.ts` and is pure JSON, which is why the round
 * trip is tested without a browser.
 *
 * Blockly is loaded lazily by the caller: it is about a megabyte, and somebody
 * who never opens this tab should never download it.
 */

import { useEffect, useRef } from "react";
import * as Blockly from "blockly/core";
import { declaredVariables, fromSource, toSource } from "../../workshop/compose.js";
import { sketchToWorkspace, workspaceToSketch, type WorkspaceJson } from "./bridge.js";
import {
  VARIABLE_CATEGORY,
  defineBlocks,
  setKnownVariables,
  toolboxFor,
  variableFlyout,
} from "./defs.js";
import { PRESENCE_FIELD, byBlock, remoteCursors } from "./presence.js";
import { writeShared, type SharedText } from "./sharedText.js";
import type { Theme } from "../../lang/vocab.js";

/** Just enough of `y-protocols` awareness for this file, so it stays testable. */
interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  setLocalStateField(field: string, value: unknown): void;
  on(event: "update", f: () => void): void;
  off(event: "update", f: () => void): void;
}

interface Props {
  source: string;
  onSource: (next: string) => void;
  theme: Theme;
  register: "simple" | "full";
  editable: boolean;
  /**
   * Working with somebody else.
   *
   * `text` is the shared document for this {robot} — edits go into it as a
   * small diff rather than through `onSource`, so two people changing
   * different handlers merge instead of overwriting. `awareness` carries who
   * is sitting on which block.
   */
  collab?: { text: SharedText; awareness: AwarenessLike } | undefined;
}

export function BlockEditor({
  source,
  onSource,
  theme,
  register,
  editable,
  collab,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  /**
   * The source this component last produced.
   *
   * Without it every change round-trips: we write source, the prop comes back
   * changed, and the effect below reloads the workspace from it — which would
   * throw away the block somebody is mid-drag and reset the scroll position on
   * every field edit.
   */
  const ours = useRef<string | null>(null);

  useEffect(() => {
    if (!host.current) return;
    setKnownVariables(declaredVariables(fromSource(sourceRef.current)));
    defineBlocks(theme, register);

    const ws = Blockly.inject(host.current, {
      toolbox: toolboxFor(register),
      // The Scratch look: rounded, chunky, inline fields. Blockly and
      // scratch-blocks are the same lineage, and this renderer is that half of
      // the fork — without scratch-blocks' own build pipeline.
      renderer: "zelos",
      readOnly: !editable,
      trashcan: editable,
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: false, startScale: register === "simple" ? 0.9 : 0.8 },
      // No block should ever be dropped somewhere it cannot be seen again.
      maxTrashcanContents: 0,
    });
    workspace.current = ws;

    // Recomputed by Blockly every time the category is opened, so a variable
    // declared a moment ago is already there to pick up.
    ws.registerToolboxCategoryCallback(VARIABLE_CATEGORY, () => variableFlyout());

    const onChange = (event: Blockly.Events.Abstract) => {
      if (ws.isDragging()) return;
      if (!Blockly.Events.BUMP_EVENTS.includes(event.type) && !isMeaningful(event)) return;
      const json = Blockly.serialization.workspaces.save(ws) as WorkspaceJson;
      // The head and tail are not blocks — see `bridge.ts` — so they are
      // carried across from the script rather than read off the canvas.
      const current = fromSource(sourceRef.current);
      json.rb = { head: current.head, tail: current.tail };
      const next = toSource(workspaceToSketch(json));
      if (next === sourceRef.current) return;
      // Declaring a variable has to make it offerable straight away, without
      // waiting for the script to come back round through React.
      setKnownVariables(declaredVariables(fromSource(next)));
      ours.current = next;
      // In a session the shared document is the truth, and it is written as
      // the small edit this really was — see `sharedText.ts`.
      if (collab) writeShared(collab.text, next);
      else onSource(next);
    };
    ws.addChangeListener(onChange);

    return () => {
      ws.removeChangeListener(onChange);
      ws.dispose();
      workspace.current = null;
    };
    // Rebuilt only when the shape of the editor itself changes. The script is
    // pushed in by the effect below rather than by re-injecting.
  }, [editable, register, theme]);

  // Kept in a ref so the change listener above reads the current script
  // without being torn down and rebuilt on every keystroke elsewhere.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const ws = workspace.current;
    if (!ws) return;
    // Our own write coming back round. Loading it again would be a no-op at
    // best and would interrupt a drag at worst.
    if (ours.current === source) return;
    ours.current = null;
    setKnownVariables(declaredVariables(fromSource(source)));
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(
        sketchToWorkspace(fromSource(source)) as object,
        ws,
      );
      /*
       * Lay the hats out in a column.
       *
       * Nothing in the serialised form carries a position — a script is an
       * order, not a canvas — so every top block loads at the origin and they
       * pile on top of one another. `cleanUp` is Blockly's own tidy, and here
       * it is not a convenience but the only thing that makes the workspace
       * readable at all.
       */
      ws.cleanUp();
      /*
       * Frame the whole {robot}, then stop zooming out.
       *
       * `scrollCenter` centres the *canvas* rather than the blocks, which on a
       * short pane put the first hat below the fold — the one thing that must
       * be visible when the tab opens. `zoomToFit` frames the content instead,
       * capped so a two-block script is not blown up to fill the pane and a
       * long one is not shrunk past reading.
       */
      ws.zoomToFit();
      const scale = Math.min(Math.max(ws.getScale(), 0.6), 1);
      ws.setScale(scale);
      ws.scrollCenter();
    } finally {
      Blockly.Events.enable();
    }
  }, [source]);

  /*
   * Say which block I am on, and draw everybody else's.
   *
   * The text editor gets this from `y-codemirror.next`, which knows how to
   * turn a character offset into a caret. A block canvas has no character
   * offsets and there is no equivalent binding for Blockly, so this is the
   * small amount of it that is actually needed. It works because block ids are
   * derived from position in the script rather than minted per workspace:
   * Blockly's own ids differ on every peer, so "I am on block xY3k" would name
   * nothing on anybody else's screen.
   */
  useEffect(() => {
    const ws = workspace.current;
    if (!ws || !collab) return;
    const { awareness } = collab;

    const publish = () => {
      const selected = Blockly.getSelected();
      const id = selected && "id" in selected ? String(selected.id) : null;
      awareness.setLocalStateField(PRESENCE_FIELD, { block: id });
    };
    ws.addChangeListener(publish);
    publish();

    const draw = () => {
      // Cleared and redrawn wholesale: a handful of halos is nothing to
      // rebuild, and tracking which peer moved where would be more state than
      // the thing it is drawing.
      for (const old of ws.getSvgGroup().querySelectorAll(".rb-presence")) old.remove();

      const groups = byBlock(remoteCursors(awareness.getStates(), awareness.clientID));
      for (const [blockId, cursors] of groups) {
        const block = ws.getBlockById(blockId);
        if (!block || !block.getSvgRoot()) continue;
        const size = block.getHeightWidth();
        const svg = block.getSvgRoot();

        cursors.forEach((cursor, i) => {
          const halo = Blockly.utils.dom.createSvgElement(
            "rect",
            {
              class: "rb-presence",
              x: -3 - i * 3,
              y: -3 - i * 3,
              width: size.width + 6 + i * 6,
              height: size.height + 6 + i * 6,
              rx: 10,
              fill: "none",
              stroke: cursor.color,
              "stroke-width": 3,
              "pointer-events": "none",
            },
            svg,
          );
          halo.setAttribute("opacity", "0.9");

          // The name sits above the block, stacked when two people share one,
          // because "we are both looking at this" is worth showing.
          const label = Blockly.utils.dom.createSvgElement(
            "text",
            {
              class: "rb-presence rb-presence-name",
              x: 2,
              y: -8 - i * 16,
              fill: cursor.color,
              "pointer-events": "none",
            },
            svg,
          );
          label.textContent = cursor.name;
        });
      }
    };

    awareness.on("update", draw);
    draw();

    return () => {
      ws.removeChangeListener(publish);
      awareness.off("update", draw);
      awareness.setLocalStateField(PRESENCE_FIELD, { block: null });
    };
  }, [collab, source]);

  return <div className="block-editor" ref={host} />;
}

/**
 * Which Blockly events are worth regenerating the script for.
 *
 * Clicks, scrolls and selections are not: they change what is on screen and
 * nothing about the {robot}, and treating them as edits would rewrite the
 * stored script every time somebody looked at it.
 */
function isMeaningful(event: Blockly.Events.Abstract): boolean {
  return (
    event.type === Blockly.Events.BLOCK_CREATE ||
    event.type === Blockly.Events.BLOCK_DELETE ||
    event.type === Blockly.Events.BLOCK_CHANGE ||
    event.type === Blockly.Events.BLOCK_MOVE
  );
}
