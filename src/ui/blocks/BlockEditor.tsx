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
import {
  declaredRoutines,
  declaredVariables,
  fromSource,
  toSource,
} from "../../workshop/compose.js";
import { sketchToWorkspace, workspaceToSketch, type WorkspaceJson } from "./bridge.js";
import {
  ROUTINE_CATEGORY,
  VARIABLE_CATEGORY,
  defineBlocks,
  routineFlyout,
  setKnownRoutines,
  setKnownVariables,
  toolboxFor,
  variableFlyout,
} from "./defs.js";
import { themeFor, themeKey } from "./theme.js";
import { applyLayout, readLayout, tidy } from "./arrange.js";
import { isComplete, pruneLayout, type Layout } from "../../workshop/layout.js";
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
  /**
   * Where the blocks were left, and how to remember where they are put.
   *
   * Kept beside the {robot} rather than in the script — see
   * `store/types.ts` — so it travels when one is traded and never becomes
   * something the compiler has to carry.
   */
  layout?: Layout | undefined;
  onLayout?: ((layout: Layout) => void) | undefined;
}

export function BlockEditor({
  source,
  onSource,
  theme,
  register,
  editable,
  collab,
  layout,
  onLayout,
}: Props) {
  /*
   * Which skin and arena the canvas is dressed for.
   *
   * Read at render rather than passed in: the two are already on the document
   * element, put there by `useProfile`, and threading them through four
   * components to arrive at the same answer would be four more places to
   * forget. A change to either rebuilds the workspace, because a Blockly theme
   * is chosen when the workspace is injected.
   */
  const skinKey = themeKey();
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
  /*
   * The workspace listener lives for the lifetime of the canvas, while both
   * destinations can change underneath it: selecting another robot replaces
   * `onSource`, and joining or leaving a room replaces `collab`. Keep the
   * listener pointed at the current render without rebuilding Blockly (and
   * losing its drag/scroll state) for either transition.
   */
  const sourceRef = useRef(source);
  const onSourceRef = useRef(onSource);
  const collabRef = useRef(collab);
  const onLayoutRef = useRef(onLayout);
  sourceRef.current = source;
  onSourceRef.current = onSource;
  collabRef.current = collab;
  onLayoutRef.current = onLayout;

  useEffect(() => {
    if (!host.current) return;
    const opening = fromSource(sourceRef.current);
    setKnownVariables(declaredVariables(opening));
    setKnownRoutines(declaredRoutines(opening));
    defineBlocks(theme, register);

    const ws = Blockly.inject(host.current, {
      toolbox: toolboxFor(register),
      /*
       * Built from the skin's own CSS custom properties — see `theme.ts`.
       * Blockly draws the workspace, toolbox and flyout as SVG with colours it
       * computes itself, so a stylesheet could only reach some of them and the
       * toolbox labels stayed grey on grey.
       */
      theme: themeFor(skinKey.split("-")[0]!, skinKey.split("-")[1]!),
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
    ws.registerToolboxCategoryCallback(ROUTINE_CATEGORY, () => routineFlyout());

    /*
     * Where a block was put is remembered, and separately from what it says.
     *
     * A move is not an edit: it does not change the {robot}, it must not touch
     * `updatedAt`, and it must not be written into the shared document during
     * a session — two people tidying the same canvas would fight over the
     * script itself rather than over a preference each of them holds.
     */
    const onMove = (event: Blockly.Events.Abstract) => {
      if (event.type !== Blockly.Events.BLOCK_MOVE || ws.isDragging()) return;
      const moved = event as Blockly.Events.BlockMove;
      // Only a top-level move is a position; dropping a statement into a hat
      // is a change to the script and is handled as one below.
      if (moved.newParentId !== undefined || moved.oldParentId !== undefined) return;
      const sketch = fromSource(sourceRef.current);
      // Pruned on the way out, so a behaviour that has been renamed does not
      // leave its old position in storage to be handed back to whatever takes
      // the name next.
      onLayoutRef.current?.(pruneLayout(readLayout(ws, sketch), sketch));
    };
    ws.addChangeListener(onMove);

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
      const grown = fromSource(next);
      setKnownVariables(declaredVariables(grown));
      setKnownRoutines(declaredRoutines(grown));
      ours.current = next;
      // In a session the shared document is the truth, and it is written as
      // the small edit this really was — see `sharedText.ts`.
      const shared = collabRef.current;
      if (shared) writeShared(shared.text, next);
      else onSourceRef.current(next);
    };
    ws.addChangeListener(onChange);

    return () => {
      ws.removeChangeListener(onMove);
      ws.removeChangeListener(onChange);
      ws.dispose();
      workspace.current = null;
    };
    // Rebuilt only when the shape or the dress of the editor changes. The
    // script is pushed in by the effect below rather than by re-injecting.
  }, [editable, register, theme, skinKey]);

  useEffect(() => {
    const ws = workspace.current;
    if (!ws) return;
    // Our own write coming back round. Loading it again would be a no-op at
    // best and would interrupt a drag at worst.
    if (ours.current === source) return;
    ours.current = null;
    const sketch = fromSource(source);
    setKnownVariables(declaredVariables(sketch));
    setKnownRoutines(declaredRoutines(sketch));
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(
        sketchToWorkspace(fromSource(source)) as object,
        ws,
      );
      /*
       * Put the blocks where they belong.
       *
       * Nothing in the serialised form carries a position — a script is an
       * order, not a canvas — so every top block loads at the origin and they
       * pile on one another. Where they go is either what was remembered, or,
       * the first time a script is opened as blocks, the canonical
       * arrangement: the same one the tidy button applies, so a {robot} looks
       * the way it will keep looking rather than being shuffled the first time
       * anybody presses anything.
       */
      const sketch = fromSource(source);
      if (isComplete(layout, sketch)) applyLayout(ws, sketch, layout!);
      else onLayout?.(tidy(ws, sketch));
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

  /**
   * Tidy.
   *
   * The same arrangement a script gets the first time it is opened, applied
   * again on request. Its value is not neatness: it is that two people who
   * started from one {robot} and changed different parts of it can lay both
   * out and see what differs, which a canvas anybody has dragged around
   * cannot show.
   */
  const onTidy = () => {
    const ws = workspace.current;
    if (!ws) return;
    onLayoutRef.current?.(tidy(ws, fromSource(sourceRef.current)));
  };

  return (
    <div className="block-editor">
      <div className="block-canvas" ref={host} />
      {editable ? (
        <button type="button" className="btn small tidy-blocks" onClick={onTidy}>
          Tidy up
        </button>
      ) : null}
    </div>
  );
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
