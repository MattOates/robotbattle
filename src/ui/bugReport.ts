/**
 * "Report a bug" that opens GitHub with the boring parts already filled in.
 *
 * A report saying "it broke" costs a round trip to become useful, so the
 * environment is gathered automatically. What is *not* gathered matters just as
 * much: no robot source, no chat, no player name. Those are the things someone
 * would be surprised to find in a public issue, and none of them help diagnose
 * a rendering bug.
 *
 * Everything lands in the GitHub compose box, so it can be read and edited
 * before it is posted.
 */

import { BRANDING } from "./branding.js";
import type { Theme } from "../lang/vocab.js";

const REPO = "https://github.com/MattOates/robotbattle";

export interface BugContext {
  theme: Theme;
  robotCount: number;
  storageBytes: number;
}

function environment(context: BugContext): string {
  const lines = [
    `- Version: ${__APP_VERSION__} (built ${__BUILD_TIME__})`,
    `- Page: ${window.location.hash || "#/"}`,
    `- World: ${BRANDING[context.theme].full}`,
    `- Robots stored: ${context.robotCount} · ${Math.round((context.storageBytes / 1024) * 10) / 10} kB`,
    `- Window: ${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio ?? 1}x`,
    `- Browser: ${navigator.userAgent}`,
  ];
  return lines.join("\n");
}

export function bugReportUrl(context: BugContext): string {
  const body = [
    "**What happened**",
    "",
    "",
    "**What you expected instead**",
    "",
    "",
    "**How to make it happen again**",
    "",
    "1. ",
    "2. ",
    "",
    "---",
    "",
    "<details><summary>Details filled in automatically — edit or delete freely</summary>",
    "",
    environment(context),
    "",
    "</details>",
  ].join("\n");

  const params = new URLSearchParams({
    title: "",
    body,
    labels: "bug",
  });
  return `${REPO}/issues/new?${params.toString()}`;
}

/** Open the prefilled issue in a new tab. */
export function openBugReport(context: BugContext): void {
  window.open(bugReportUrl(context), "_blank", "noopener,noreferrer");
}
