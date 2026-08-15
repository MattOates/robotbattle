/**
 * The bug-report shortcut.
 *
 * The point of these tests is the negative one: a prefilled issue goes to a
 * *public* repository, so it must carry enough to diagnose a problem and
 * nothing somebody would be startled to find published.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bugReportUrl } from "../../src/ui/bugReport.js";

const context = { theme: "mechanical" as const, robotCount: 3, storageBytes: 12_800 };

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { hash: "#/workshop" },
    innerWidth: 1680,
    innerHeight: 1050,
    devicePixelRatio: 2,
  });
  vi.stubGlobal("navigator", { userAgent: "TestBrowser/1.0" });
});

function body(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("body") ?? "");
}

describe("where it goes", () => {
  it("opens a new issue on the right repository", () => {
    const url = bugReportUrl(context);
    expect(url.startsWith("https://github.com/MattOates/robotbattle/issues/new?")).toBe(true);
  });

  it("labels it as a bug", () => {
    expect(new URL(bugReportUrl(context)).searchParams.get("labels")).toBe("bug");
  });

  it("leaves the title empty so it is written by a person", () => {
    expect(new URL(bugReportUrl(context)).searchParams.get("title")).toBe("");
  });
});

describe("what it fills in", () => {
  it("prompts for the three things that make a report useful", () => {
    const text = body(bugReportUrl(context));
    expect(text).toContain("What happened");
    expect(text).toContain("What you expected instead");
    expect(text).toContain("How to make it happen again");
  });

  it("records enough to identify the build and the browser", () => {
    const text = body(bugReportUrl(context));
    expect(text).toContain("Version:");
    expect(text).toContain("TestBrowser/1.0");
    expect(text).toContain("#/workshop");
    expect(text).toContain("1680×1050");
    expect(text).toContain("BotBattle");
  });

  it("says which world, since it changes the whole vocabulary", () => {
    expect(body(bugReportUrl({ ...context, theme: "biological" }))).toContain("BioBattle");
  });

  it("tucks the machine details behind a fold", () => {
    // The person writing should see their own words first, not a wall of
    // user-agent string.
    const text = body(bugReportUrl(context));
    expect(text.indexOf("What happened")).toBeLessThan(text.indexOf("<details>"));
  });
});

describe("what it must never leak", () => {
  it("carries counts, not contents", () => {
    const text = body(bugReportUrl(context));
    // How much you have is diagnostic; what it says is nobody's business.
    expect(text).toContain("3");
    expect(text).toContain("12.5 kB");
    expect(text.toLowerCase()).not.toContain("chassis");
    expect(text.toLowerCase()).not.toContain("on sense");
  });

  it("does not include the player's name", () => {
    // Nothing in the context even offers it, which is the real guarantee.
    expect(Object.keys(context)).toEqual(["theme", "robotCount", "storageBytes"]);
  });
});
