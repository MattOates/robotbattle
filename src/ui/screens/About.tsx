/**
 * About and credits.
 *
 * Also where the sponsor card lives. The card is an embed from github.com, so
 * it is the one part of this game that needs the network — everything else
 * runs entirely in the browser. A plain link sits underneath it so the ask
 * still works when the embed is blocked, offline, or slow.
 */

import { navigate } from "../router.js";
import { bugReportUrl } from "../bugReport.js";
import { BRANDING } from "../branding.js";
import { THEMES, type Theme } from "../../lang/vocab.js";

const SPONSOR_URL = "https://github.com/sponsors/MattOates";
const REPO_URL = "https://github.com/MattOates/robotbattle";

interface Props {
  theme: Theme;
  robotCount: number;
  storageBytes: number;
}

interface Credit {
  name: string;
  url: string;
  what: string;
}

const BUILT_WITH: Credit[] = [
  { name: "PixiJS", url: "https://pixijs.com", what: "the arena renderer" },
  { name: "CodeMirror", url: "https://codemirror.net", what: "the editor" },
  { name: "Yjs", url: "https://yjs.dev", what: "shared editing that actually converges" },
  { name: "PeerJS", url: "https://peerjs.com", what: "introducing browsers to each other" },
  { name: "React", url: "https://react.dev", what: "the interface" },
  { name: "Vite", url: "https://vite.dev", what: "the build" },
];

export function About({ theme, robotCount, storageBytes }: Props) {
  const brand = BRANDING[theme];
  const words = THEMES[theme];

  return (
    <div className="about">
      <header className="screen-head">
        <button type="button" className="btn small" onClick={() => navigate("menu")}>
          ← Menu
        </button>
        <h2 className="screen-title">About</h2>
      </header>

      <div className="about-body">
        <section className="about-lead">
          <h1 className="about-title">
            {brand.prefix}
            <span>{brand.suffix}</span>
          </h1>
          <p className="about-strap">{brand.strap}</p>
        </section>

        <section className="about-panel">
          <h3 className="silkscreen">Where it comes from</h3>
          <p>
            A spiritual successor to <strong>Robot Battle</strong> (1993, Brad Schick), which
            had you program robots in a scripting language of its own, and{" "}
            <strong>Robocode</strong> (2000, IBM alphaWorks), which made it event-driven with a
            gun that turned independently of the body. This takes the DSL from the first and the
            event model from the second, and adds two things neither had: locomotion that
            genuinely handles differently, and a second vocabulary so the same game can be taught
            as biology.
          </p>
          <p>
            Nobody writes JavaScript here. Scripts compile to bytecode for a small virtual
            machine whose whole world is a fixed table of properties and actions, which is what
            makes it safe to run a script somebody handed you. A robot that loops forever becomes
            sluggish rather than freezing the match.
          </p>
        </section>

        <section className="about-panel">
          <h3 className="silkscreen">Support the work</h3>
          <p>
            {brand.full} is free, has no accounts, and stores your {words.robotPlural} on your own
            machine. If you would like to help it keep going:
          </p>
          {/* Trimmed from GitHub's suggested 225: the card's lower half is
              empty, and a tall white slab reads badly on a dark page. */}
          <div className="sponsor-card">
            <iframe
              src="https://github.com/sponsors/MattOates/card"
              title="Sponsor MattOates on GitHub"
              height="150"
              width="600"
              loading="lazy"
              style={{ border: 0 }}
            />
          </div>
          {/* Shown always, not only as a fallback: the card is an embed and can
              be blocked, and an ask that silently disappears is no ask. */}
          <p className="about-fallback">
            <a href={SPONSOR_URL} target="_blank" rel="noreferrer noopener">
              Sponsor MattOates on GitHub&nbsp;↗
            </a>
          </p>
        </section>

        <section className="about-panel">
          <h3 className="silkscreen">Built with</h3>
          <ul className="credit-list">
            {BUILT_WITH.map((credit) => (
              <li key={credit.name}>
                <a href={credit.url} target="_blank" rel="noreferrer noopener">
                  {credit.name}
                </a>
                <span className="roster-meta"> — {credit.what}</span>
              </li>
            ))}
          </ul>
          <p className="about-fallback">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              Source on GitHub&nbsp;↗
            </a>
            {" · "}
            <a
              href={bugReportUrl({ theme, robotCount, storageBytes })}
              target="_blank"
              rel="noreferrer noopener"
            >
              Report a bug&nbsp;↗
            </a>
          </p>
        </section>

        <section className="about-panel">
          <h3 className="silkscreen">Your data</h3>
          <p>
            Everything you build stays in this browser. There is no server, no account and
            nothing is uploaded. Battles between people go directly browser to browser; a
            matchmaking service is used only to introduce you, and never sees a robot. You can
            delete the lot from settings, top right.
          </p>
        </section>
      </div>
    </div>
  );
}
