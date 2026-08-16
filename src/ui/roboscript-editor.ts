/**
 * CodeMirror wiring for RoboScript.
 *
 * A thin adapter, on purpose. Highlighting reuses the tolerant scanner from
 * `src/lang/scan.ts`, completion delegates to `src/lang/complete.ts`, and lint
 * markers come from the real compiler. Nothing about the language is defined
 * twice here, so the editor cannot disagree with the compiler about what
 * RoboScript is.
 */

import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  indentUnit,
  type StringStream,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { linter, lintGutter, lintKeymap, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { Tag, tags as t } from "@lezer/highlight";

import { scanLine, type LooseToken } from "../lang/scan.js";
import {
  completeAt,
  completionKeepsGoing,
  routineNote,
  routinesIn,
  type Suggestion,
  type SuggestionKind,
} from "../lang/complete.js";
import { checkScript } from "../sim/world.js";
import type { Theme } from "../lang/vocab.js";

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

/** Roles the standard tag set has no good name for. */
const tAction = Tag.define();
const tEventWord = Tag.define();
const tObject = Tag.define();
const tColorLiteral = Tag.define();

/** Canonical words, grouped by the role they play when read aloud. */
const CONTROL = new Set([
  "on",
  "end",
  "var",
  "set",
  "if",
  "else",
  "then",
  "loop",
  "for",
  "repeat",
  "break",
  "continue",
  "wait",
  "name",
  "chassis",
  "color",
  "colour",
  "can",
  "do",
  "with",
  "given",
  "every",
  "after",
  "before",
]);
const MODIFIERS = new Set(["to", "by", "at", "forward", "back", "backward", "times", "ticks"]);
const ACTIONS = new Set([
  "drive",
  "stop",
  "turn",
  "fire",
  "turret",
  "aim",
  "sweep",
  "radar",
  "ping",
]);
const EVENT_WORDS = new Set([
  "start",
  "tick",
  "sense",
  "hit",
  "bullet",
  "robot",
  "wall",
  "missed",
  "destroyed",
  "ping",
]);
const OBJECTS = new Set(["me", "arena", "event"]);
const VALUES = new Set(["true", "false", "none", "skid", "steered"]);
const OPERATOR_WORDS = new Set(["is", "isnt", "not", "and", "or", "mod"]);

/**
 * Which role a token plays, as a style name.
 *
 * Exported so a test can hold it against the parser's own reserved-word list:
 * a word the language knows but the highlighter does not would quietly render
 * as somebody's variable, which is exactly how a new instruction gets shipped
 * looking like a typo.
 */
export function styleFor(tok: LooseToken, previous: LooseToken | undefined): string | null {
  switch (tok.kind) {
    case "comment":
      return "comment";
    case "string":
      return tok.unterminated ? "invalid" : "string";
    case "number":
      return "number";
    case "color":
      return "colour";
    case "error":
      return "invalid";
    case "punct":
      return "operator";
    case "word":
      break;
    default:
      return null;
  }

  // Anything straight after a dot reads as a property, whatever the word is.
  if (previous?.kind === "punct" && previous.text === ".") return "propertyName";

  // Words are classified by their CANONICAL form, so themed synonyms highlight
  // exactly like the words they stand for.
  const canonical = tok.canonical[0] ?? tok.text;

  // `ping` is both an action and the first word of two events. Straight after
  // `on` it is naming an event, and should read like `sense` rather than like
  // `fire`; anywhere else it is an instruction.
  const afterOn = previous?.kind === "word" && (previous.canonical[0] ?? previous.text) === "on";
  if (afterOn && EVENT_WORDS.has(canonical)) return "eventWord";

  if (CONTROL.has(canonical)) return "keyword";
  if (ACTIONS.has(canonical)) return "action";
  if (EVENT_WORDS.has(canonical)) return "eventWord";
  if (OBJECTS.has(canonical)) return "object";
  if (VALUES.has(canonical)) return "atom";
  if (OPERATOR_WORDS.has(canonical)) return "operator";
  if (MODIFIERS.has(canonical)) return "modifier";
  return "variableName";
}

interface StreamState {
  tokens: LooseToken[];
  index: number;
}

const roboLanguage = StreamLanguage.define<StreamState>({
  name: "roboscript",
  startState: () => ({ tokens: [], index: 0 }),

  token(stream: StringStream, state: StreamState): string | null {
    // RoboScript has no constructs that span lines, so each line can be scanned
    // independently with the real scanner and then served token by token.
    if (stream.sol()) {
      state.tokens = scanLine(stream.string);
      state.index = 0;
    }
    if (stream.eatSpace()) return null;

    while (state.index < state.tokens.length && state.tokens[state.index]!.end <= stream.pos) {
      state.index++;
    }
    const tok = state.tokens[state.index];
    if (!tok || tok.start > stream.pos) {
      stream.next();
      return null;
    }
    const previous = state.index > 0 ? state.tokens[state.index - 1] : undefined;
    stream.pos = tok.end;
    state.index++;
    return styleFor(tok, previous);
  },

  tokenTable: {
    action: tAction,
    eventWord: tEventWord,
    object: tObject,
    colour: tColorLiteral,
    modifier: t.modifier,
  },

  languageData: {
    commentTokens: { line: "--" },
    // Autocomplete replaces the word you are typing, and `.` starts a new one.
    wordChars: "_",
  },
});

/**
 * Colours chosen against the instrument palette: amber for the words that
 * structure a script, cyan for the things it can act on, green for the world
 * talking back.
 */
const roboHighlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--ink-muted)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--signal)", fontWeight: "600" },
  { tag: tAction, color: "var(--readout)", fontWeight: "600" },
  { tag: tEventWord, color: "#e6b3ff" },
  { tag: tObject, color: "#8fbf6a" },
  { tag: t.propertyName, color: "#b6e3a8" },
  { tag: t.modifier, color: "var(--ink-muted)" },
  { tag: t.number, color: "#ffd9a0" },
  { tag: t.string, color: "#a8d8ff" },
  { tag: tColorLiteral, color: "#ffb3d9", fontWeight: "600" },
  { tag: t.atom, color: "#ffb3d9" },
  { tag: t.operator, color: "var(--ink-muted)" },
  { tag: t.variableName, color: "var(--ink)" },
  { tag: t.invalid, color: "var(--alert)", textDecoration: "underline wavy" },
]);

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

const ICON_FOR: Readonly<Record<SuggestionKind, string>> = {
  event: "class",
  action: "method",
  keyword: "keyword",
  property: "property",
  function: "function",
  variable: "variable",
  value: "constant",
  color: "constant",
};

/** Render multi-line help as a real block, since CodeMirror shows info as text. */
function infoNode(text: string): () => Node {
  return () => {
    const el = document.createElement("div");
    el.className = "cm-robo-info";
    el.textContent = text;
    return el;
  };
}

function toCompletion(s: Suggestion, index: number): Completion {
  const out: Completion = {
    label: s.label,
    type: ICON_FOR[s.kind],
    // Preserve the order the language module chose; without this, CodeMirror
    // would alphabetise and bury the useful suggestions.
    boost: -index,
  };
  if (s.detail) out.detail = s.detail;
  if (s.info) out.info = infoNode(s.info);
  // `can shove given` is going somewhere, so hand the line back ready for the
  // next word rather than pressed up against the one just accepted.
  if (completionKeepsGoing(s.label)) out.apply = `${s.label} `;
  return out;
}

function roboCompletions(theme: Theme) {
  return (context: CompletionContext): CompletionResult | null => {
    const result = completeAt(context.state.doc.toString(), context.pos, theme);
    if (!result) return null;
    return {
      from: result.from,
      options: result.options.map(toCompletion),
      // Keep the popup open and filtering while a word is being typed.
      validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
    };
  };
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

const roboLinter = linter((view) => {
  const source = view.state.doc.toString();
  const check = checkScript(source);
  if (check.ok || !check.error) return [];

  const err = check.error;
  const doc = view.state.doc;
  const line = doc.line(Math.min(Math.max(1, err.line), doc.lines));
  const from = Math.min(line.from + Math.max(0, err.col - 1), line.to);

  // Underline the whole word at fault where there is one, so the squiggle is
  // easy to hit rather than a single character.
  const rest = doc.sliceString(from, line.to);
  const wordLength = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0].length ?? 0;
  const to = wordLength > 0 ? from + wordLength : Math.max(from + 1, line.to);

  const diagnostic: Diagnostic = {
    from,
    to: Math.min(to, doc.length),
    severity: "error",
    message: err.hint ? `${err.message}\n\n${err.hint}` : err.message,
  };
  return [diagnostic];
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/**
 * A dim note at the end of a `can` line, saying what will become of it.
 *
 * Whether a block runs by itself is decided by the rest of the file — whether
 * anything needs handing to it, and whether an `on` block for the same event
 * exists somewhere else — so the line itself cannot say. Without this the
 * difference between a block that runs and one that sits there is invisible,
 * which is exactly the mistake somebody makes after pasting one in.
 *
 * Read off the tolerant scanner rather than a compile, so it keeps up with a
 * half-typed script and costs nothing.
 */
class NoteWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  override eq(other: NoteWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-robo-note";
    span.textContent = this.text;
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function routineNotes(view: EditorView, theme: Theme): DecorationSet {
  const source = view.state.doc.toString();
  if (!source.includes("can")) return Decoration.none;

  // Never on the line being worked on. The note sits after the end of the
  // line, which is exactly where the caret is while that line is being typed —
  // so leaving it there puts a gap and some italic text between you and your
  // own cursor, and every accepted completion makes it jump. It is a note about
  // a finished line, so it waits until the line is finished with.
  const busy = new Set<number>();
  for (const range of view.state.selection.ranges) {
    busy.add(view.state.doc.lineAt(range.head).number);
    busy.add(view.state.doc.lineAt(range.anchor).number);
  }

  const { routines, handled } = routinesIn(source);
  const marks = routines.flatMap((routine) => {
    // `line` is zero-based from the scan; CodeMirror counts from one.
    if (routine.line + 1 > view.state.doc.lines) return [];
    const line = view.state.doc.line(routine.line + 1);
    if (busy.has(line.number)) return [];
    const note = routineNote(routine, handled, theme).replace(/`/g, "");
    if (note === "") return [];
    return [Decoration.widget({ widget: new NoteWidget(note), side: 1 }).range(line.to)];
  });
  return Decoration.set(marks, true);
}

function routineNotePlugin(theme: Theme): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = routineNotes(view, theme);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = routineNotes(update.view, theme);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const roboTheme = EditorView.theme(
  {
    "&": {
      color: "var(--ink)",
      backgroundColor: "transparent",
      fontSize: "12.5px",
      height: "100%",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.55",
      padding: "10px 0",
      caretColor: "var(--signal)",
    },
    ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
    ".cm-robo-note": {
      marginLeft: "1.6em",
      color: "var(--ink-muted)",
      opacity: "0.75",
      fontSize: "11px",
      fontStyle: "italic",
      // Never let the note take a click meant for the code behind it.
      pointerEvents: "none",
      userSelect: "none",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--ink-muted)",
      border: "none",
      borderRight: "1px solid var(--bezel)",
      paddingRight: "2px",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--signal)" },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.028)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--signal)", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(232, 163, 61, 0.22)",
    },
    ".cm-lintRange-error": {
      backgroundImage: "none",
      textDecoration: "underline wavy var(--alert)",
      textUnderlineOffset: "3px",
    },
    ".cm-lint-marker-error": { content: "none" },
    ".cm-tooltip": {
      backgroundColor: "var(--panel-raised)",
      border: "1px solid var(--bezel-light)",
      borderRadius: "3px",
      color: "var(--ink)",
      fontFamily: "var(--font-body)",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
      maxHeight: "16em",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      padding: "3px 8px",
      display: "flex",
      alignItems: "baseline",
      gap: "8px",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--signal)",
      color: "#17190f",
    },
    ".cm-completionLabel": { flex: "none" },
    ".cm-completionDetail": {
      fontFamily: "var(--font-body)",
      fontStyle: "normal",
      fontSize: "11px",
      color: "var(--ink-muted)",
      marginLeft: "auto",
      textAlign: "right",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      maxWidth: "22em",
    },
    "li[aria-selected] .cm-completionDetail": { color: "rgba(23, 25, 15, 0.75)" },
    ".cm-tooltip.cm-completionInfo": {
      padding: "0",
      maxWidth: "26em",
      backgroundColor: "var(--panel-raised)",
    },
    ".cm-robo-info": {
      whiteSpace: "pre-wrap",
      fontFamily: "var(--font-body)",
      fontSize: "12px",
      lineHeight: "1.5",
      color: "var(--ink)",
      padding: "8px 10px",
    },
    ".cm-diagnostic": {
      fontFamily: "var(--font-mono)",
      fontSize: "11.5px",
      whiteSpace: "pre-wrap",
      padding: "6px 8px",
    },
    ".cm-diagnostic-error": { borderLeft: "3px solid var(--alert)" },
  },
  { dark: true },
);

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Swapped when the player changes theme, so suggestions change vocabulary. */
export const completionCompartment = new Compartment();

export function completionExtension(theme: Theme): Extension {
  return autocompletion({
    override: [roboCompletions(theme)],
    // Beginners should not have to know a shortcut exists to discover the
    // language, so the popup opens as they type.
    activateOnTyping: true,
    closeOnBlur: true,
    icons: true,
    maxRenderedOptions: 40,
    defaultKeymap: true,
  });
}

export function roboExtensions(theme: Theme): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    closeBrackets(),
    lintGutter(),
    roboLinter,
    roboLanguage,
    syntaxHighlighting(roboHighlight),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    completionCompartment.of(completionExtension(theme)),
    routineNotePlugin(theme),
    keymap.of([
      // Completion goes first, or `defaultKeymap` claims Return and the
      // highlighted suggestion is passed over for a new line — which is a
      // strange thing to have to discover about a popup that says "press
      // Ctrl-Space for suggestions". Every binding here does nothing at all
      // while the popup is closed, so nothing else is shadowed.
      ...completionKeymap,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    roboTheme,
    EditorView.lineWrapping,
  ];
}
