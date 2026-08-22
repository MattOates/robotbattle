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

import { useCallback, useEffect, useMemo, useState } from "react";
import { navigate } from "../router.js";
import { Prose } from "../Prose.js";
import { translate } from "../../learn/translate.js";
import { EVENT_DOCS, renderDoc } from "../../lang/events.js";
import { EVENT_NAMES } from "../../lang/ast.js";
import { BUILTINS, signatureOf } from "../../lang/builtins.js";
import {
  ruleDoc,
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

/** The page's own sections, including the ones that are not grammar. */
type Tab = "syntax" | "events" | "functions" | "values" | "world";

/**
 * Outermost first, and the grammar last.
 *
 * Somebody arriving wants to know what the world does before what the words
 * are: the arena and its numbers, then what your {robot} is told about, then
 * the functions and values it can work with. Syntax goes at the end because it
 * is the part you look up once you already know what you are trying to say, and
 * it is the least inviting thing to land on first.
 */
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "world", label: "The world" },
  { id: "events", label: "Events" },
  { id: "functions", label: "Functions" },
  { id: "values", label: "Values" },
  { id: "syntax", label: "Syntax" },
];

/** Which tab a rule's section is shown on. */
function tabFor(section: string): Tab {
  if (section === "events") return "events";
  if (section === "values") return "values";
  return "syntax";
}

export function Reference({ theme }: Props) {
  const [tab, setTab] = useState<Tab>(TABS[0]!.id);
  const [wanted, setWanted] = useState<string | null>(null);
  const doc = (text: string) => renderDoc(text, theme);

  /**
   * Following a rule from a diagram to its own entry.
   *
   * The rule may live on another tab, so the tab changes first and the scroll
   * waits for the entry to exist — which is why the target is held in state
   * rather than scrolled to here.
   */
  const goToRule = useCallback((name: string) => {
    const doc = ruleDoc(name);
    if (!doc) return;
    setTab(tabFor(doc.section));
    setWanted(name);
  }, []);

  useEffect(() => {
    if (!wanted) return;
    const target = document.getElementById(`rule-${wanted}`);
    setWanted(null);
    if (!target) return;
    // Deliberately not a smooth scroll. Following a rule is a jump to a
    // definition, and a browser with smooth scrolling turned off — by the
    // user's motion preference or by policy — treats `behavior: "smooth"` as
    // "do not scroll at all" rather than as "scroll instantly", which would
    // make the link silently do nothing. The mark below says where you landed.
    target.scrollIntoView({ block: "start" });
    // A brief mark, because a smooth scroll landing on a page of similar boxes
    // leaves you unsure which one you asked for.
    target.classList.add("found");
    setTimeout(() => target.classList.remove("found"), 1600);
  }, [wanted, tab]);

  /**
   * One listener for every diagram on the page. The boxes are plain SVG with
   * the rule name on them, so this finds the nearest one to whatever was hit.
   */
  const onClick = useCallback(
    (event: React.MouseEvent) => {
      const box = (event.target as Element).closest?.("[data-rule]");
      const name = box?.getAttribute("data-rule");
      if (name) goToRule(name);
    },
    [goToRule],
  );

  return (
    <div className="learn">
      <header className="screen-head">
        <button type="button" className="btn small" onClick={() => navigate("menu")}>
          ← Menu
        </button>
        <h2 className="screen-title">Reference</h2>
        <span className="spacer" />
        <span className="roster-meta">Look anything up</span>
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

      <div className="learn-body prose" onClick={onClick}>
        {tab === "syntax" ? <Syntax theme={theme} /> : null}
        {tab === "events" ? <Events theme={theme} doc={doc} /> : null}
        {tab === "functions" ? <Functions doc={doc} /> : null}
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
  const svg = useMemo(() => railroad(rule.syntax, theme), [rule.syntax, theme]);
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
        <Prose
          text={doc(
            "Inside a block, `event.` tells you about the thing that just happened. " +
              "Different events know different things, so asking one for something it " +
              "has not got is a mistake — and your {robot} will point it out before the " +
              "match starts, rather than quietly using 0.",
          )}
        />
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
                This event does not bring anything with it, so there is no{" "}
                <code>event.</code> to read.
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

    </section>
  );
}

// --- functions --------------------------------------------------------------

/**
 * Their own tab rather than a heading inside Values.
 *
 * There are thirteen of them and each takes a description, an argument list and
 * an example, so as a section at the bottom of another page they were most of
 * that page and easy to miss. A function is also the thing you come here
 * knowing you want and needing the details of, which is what a tab is for.
 */
function Functions({ doc }: { doc: (t: string) => string }) {
  return (
    <section className="ref-section">
      <h2>Functions</h2>
      <p>
        <Prose
          text={doc(
            "These are all the functions there are. If you use a name that is not on " +
              "this list, your {robot} will not start, and it will show you this list.",
          )}
        />
      </p>
      {Object.entries(BUILTINS).map(([name, fn]) => (
        <article key={name} className="ref-rule">
          <h4>
            <code>{signatureOf(name)}</code>
          </h4>
          <p>
            <Prose text={fn.summary} />
          </p>
          {fn.params.length > 0 ? (
            <dl className="ref-fields">
              {fn.params.map((param) => (
                <div key={param.name}>
                  <dt>
                    <code>{param.name}</code>
                  </dt>
                  <dd>
                    <Prose text={param.detail} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="ref-none">Takes nothing — the brackets stay empty.</p>
          )}
          <pre className="ref-example">
            <code>{fn.example}</code>
          </pre>
        </article>
      ))}
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
        Your instructions say what you would like to happen. This page is what
        actually happens: how fast time goes, how far you can see, and how much
        a shot hurts.
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
