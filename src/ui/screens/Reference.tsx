/**
 * Reference: the language and the simulation, looked up rather than taught.
 *
 * The Learn chapters introduce one idea at a time, which is right for somebody
 * starting and useless to somebody who knows what they want and needs to check
 * what `turret.sweep` takes or how far a ping reaches. This page answers that.
 *
 * Almost none of it is written here. The syntax comes from the parser's own
 * grammar through `reference.ts`, the events from `EVENT_DOCS`, the properties
 * and functions from the compiler's lists, and the numbers from the
 * simulation's constants — so the page cannot describe a language or a world
 * that no longer exists. What is written by hand is prose about meaning, and it
 * lives next to the thing it describes with a test that notices its absence.
 */

import { useMemo, useState } from "react";
import { navigate } from "../router.js";
import { translate } from "../../learn/translate.js";
import { EVENT_DOCS, renderDoc } from "../../lang/events.js";
import { EVENT_NAMES } from "../../lang/ast.js";
import { BUILTIN_SIGNATURES } from "../../lang/bytecode.js";
import {
  rulesIn,
  SECTIONS,
  simulationFacts,
  syntaxLine,
  type RuleDoc,
} from "../../lang/reference.js";
import { propertyReference } from "../../lang/complete.js";
import { railroad } from "../railroad.js";
import { phraseFor, wordFor, type Theme } from "../../lang/vocab.js";

interface Props {
  theme: Theme;
}

/**
 * Backticked spans as real code, without pulling in a markdown renderer.
 *
 * The prose in `reference.ts`, `EVENT_DOCS` and the rest is written the way the
 * completion popup wants it — plain text with backticks — because that is where
 * most of it is also shown. Rendering it as markdown here would mean the two
 * places disagreed about what is allowed in it; this way a backtick means the
 * one thing everywhere.
 */
function Prose({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/** The page's own sections, including the ones that are not grammar. */
type Tab = "syntax" | "events" | "values" | "world";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "syntax", label: "Syntax" },
  { id: "events", label: "Events" },
  { id: "values", label: "Values" },
  { id: "world", label: "The world" },
];

export function Reference({ theme }: Props) {
  const [tab, setTab] = useState<Tab>("syntax");
  const doc = (text: string) => renderDoc(text, theme);

  return (
    <div className="learn reference">
      <header className="screen-head">
        <button type="button" className="back" onClick={() => navigate("menu")}>
          Back
        </button>
        <h1>Reference</h1>
        <p className="screen-strap">
          Every word the language has, read out of the parser itself.
        </p>
      </header>

      <nav className="ref-tabs" aria-label="Reference sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ref-tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="learn-body prose">
        {tab === "syntax" ? <Syntax theme={theme} /> : null}
        {tab === "events" ? <Events theme={theme} doc={doc} /> : null}
        {tab === "values" ? <Values theme={theme} doc={doc} /> : null}
        {tab === "world" ? <World theme={theme} doc={doc} /> : null}
      </div>
    </div>
  );
}

// --- syntax ----------------------------------------------------------------

const GRAMMAR_TABS = ["program", "cadence", "statements", "actions"] as const;

function Syntax({ theme }: { theme: Theme }) {
  const sections = useMemo(
    () => SECTIONS.filter((s) => (GRAMMAR_TABS as readonly string[]).includes(s.name)),
    [],
  );
  return (
    <>
      {sections.map((section) => (
        <section key={section.name} className="ref-section">
          <h2>{renderDoc(section.title, theme)}</h2>
          <p><Prose text={renderDoc(section.blurb, theme)} /></p>
          {rulesIn(section.name).map((rule) => (
            <Rule key={rule.name} rule={rule} theme={theme} />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * One rule: what it is called, what it means, its shape twice over.
 *
 * Twice because the two readings suit different people. The line is compact and
 * searchable; the diagram shows at a glance which parts are optional and which
 * repeat, which is exactly what a line of brackets is worst at.
 */
function Rule({ rule, theme }: { rule: RuleDoc; theme: Theme }) {
  const svg = useMemo(() => railroad(rule.syntax), [rule.syntax]);
  return (
    <article className="ref-rule" id={`rule-${rule.name}`}>
      <h3>{renderDoc(rule.title, theme)}</h3>
      <p><Prose text={renderDoc(rule.summary, theme)} /></p>
      <code className="ref-syntax">{syntaxLine(rule.syntax, theme)}</code>
      <div className="ref-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
      {rule.example ? (
        <pre className="ref-example">
          <code>{translate(rule.example, theme)}</code>
        </pre>
      ) : null}
    </article>
  );
}

// --- events -----------------------------------------------------------------

function Events({ theme, doc }: { theme: Theme; doc: (t: string) => string }) {
  const section = SECTIONS.find((s) => s.name === "events")!;
  return (
    <section className="ref-section">
      <h2>{doc(section.title)}</h2>
      <p><Prose text={doc(section.blurb)} /></p>

      {rulesIn("events").map((rule) => (
        <Rule key={rule.name} rule={rule} theme={theme} />
      ))}

      <h3>Every event</h3>
      <p>
        Inside a block, <code>event.</code> carries whatever that event knows.
        The fields differ, which is why asking for one the event has not got is
        refused when the script is compiled rather than quietly read as 0.
      </p>
      {[...EVENT_NAMES].map((name) => {
        const info = EVENT_DOCS[name];
        return (
          <article key={name} className="ref-event">
            <h4>
              <code>{`${wordFor("on", theme)} ${phraseFor(name, theme)}`}</code>
            </h4>
            <p><Prose text={doc(info.summary)} /></p>
            {info.fields.length > 0 ? (
              <dl className="ref-fields">
                {info.fields.map((field) => (
                  <div key={field.name}>
                    <dt>
                      <code>{`event.${field.name}`}</code>
                    </dt>
                    <dd><Prose text={doc(field.detail)} /></dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="ref-none">
                Carries nothing — there is no <code>event.</code> to read here.
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}

// --- values -----------------------------------------------------------------

function Values({ theme, doc }: { theme: Theme; doc: (t: string) => string }) {
  const section = SECTIONS.find((s) => s.name === "values")!;
  const { me, arena } = useMemo(() => propertyReference(theme), [theme]);
  return (
    <section className="ref-section">
      <h2>{doc(section.title)}</h2>
      <p><Prose text={doc(section.blurb)} /></p>

      {rulesIn("values").map((rule) => (
        <Rule key={rule.name} rule={rule} theme={theme} />
      ))}

      <h3>
        What <code>me.</code> knows
      </h3>
      <dl className="ref-fields">
        {me.map((p) => (
          <div key={p.label}>
            <dt>
              <code>{`me.${p.label}`}</code>
            </dt>
            <dd><Prose text={p.detail ?? ""} /></dd>
          </div>
        ))}
      </dl>

      <h3>
        What <code>arena.</code> knows
      </h3>
      <dl className="ref-fields">
        {arena.map((p) => (
          <div key={p.label}>
            <dt>
              <code>{`arena.${p.label}`}</code>
            </dt>
            <dd><Prose text={p.detail ?? ""} /></dd>
          </div>
        ))}
      </dl>

      <h3>Functions</h3>
      <p>
        The complete list. Anything else with brackets after it is refused, with
        these named — so a misspelling is caught rather than treated as a
        variable.
      </p>
      <dl className="ref-fields">
        {Object.entries(BUILTIN_SIGNATURES).map(([name, arity]) => (
          <div key={name}>
            <dt>
              <code>{`${name}(${arity === 0 ? "" : Array.from({ length: arity }, (_, i) => String.fromCharCode(97 + i)).join(", ")})`}</code>
            </dt>
            <dd>{`${arity} value${arity === 1 ? "" : "s"}.`}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// --- the simulation ---------------------------------------------------------

function World({ theme, doc }: { theme: Theme; doc: (t: string) => string }) {
  const groups = useMemo(() => simulationFacts(theme), [theme]);
  return (
    <section className="ref-section">
      <h2>How the world works</h2>
      <p>
        The language says what you can ask for. These say what happens when you
        do — read out of the simulation's own constants, so tuning the balance
        rewrites this page rather than dating it.
      </p>
      {groups.map((group) => (
        <article key={group.title} className="ref-facts">
          <h3>{group.title}</h3>
          <p><Prose text={doc(group.blurb)} /></p>
          <dl className="ref-fields">
            {group.facts.map((fact) => (
              <div key={fact.label}>
                <dt>
                  {fact.label}
                  <span className="ref-value">{fact.value}</span>
                </dt>
                <dd><Prose text={doc(fact.note)} /></dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </section>
  );
}
