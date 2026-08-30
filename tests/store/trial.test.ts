/**
 * Remembering who you last fought.
 *
 * The panel used to reset to Spinner and Racer on every visit, which is fine
 * once and maddening on the twentieth run of the same experiment.
 */

import { describe, expect, it } from "vitest";
import { MemoryStore, wipe } from "../../src/store/storage.js";
import { DEFAULT_OPPONENTS, TrialPrefs } from "../../src/store/trial.js";

describe("TrialPrefs", () => {
  it("starts with one that moves and one that shoots", () => {
    expect(new TrialPrefs(new MemoryStore()).opponents()).toEqual([...DEFAULT_OPPONENTS]);
  });

  it("remembers a choice across sessions", () => {
    const store = new MemoryStore();
    new TrialPrefs(store).setOpponents(["hunter"]);
    expect(new TrialPrefs(store).opponents()).toEqual(["hunter"]);
  });

  it("remembers an empty choice rather than treating it as unset", () => {
    // Unticking everything is a decision — the trial then runs solo, which is
    // a real thing to want. Falling back to the defaults would override it.
    const store = new MemoryStore();
    new TrialPrefs(store).setOpponents([]);
    expect(new TrialPrefs(store).opponents()).toEqual([]);
  });

  it("falls back rather than trusting nonsense", () => {
    // Read straight into a UI on first render, so a corrupt entry has to be
    // treated as absent rather than handed onwards.
    const store = new MemoryStore();
    store.set("trialOpponents", '{"not":"a list"}');
    expect(new TrialPrefs(store).opponents()).toEqual([...DEFAULT_OPPONENTS]);
    store.set("trialOpponents", "[1, 2, 3]");
    expect(new TrialPrefs(store).opponents()).toEqual([...DEFAULT_OPPONENTS]);
    store.set("trialOpponents", "not json at all");
    expect(new TrialPrefs(store).opponents()).toEqual([...DEFAULT_OPPONENTS]);
  });

  it("hands back a copy, so the caller cannot edit what is stored", () => {
    const store = new MemoryStore();
    const prefs = new TrialPrefs(store);
    prefs.setOpponents(["hunter"]);
    prefs.opponents().push("apex");
    expect(prefs.opponents()).toEqual(["hunter"]);
  });

  it("is forgotten when everything is", () => {
    const store = new MemoryStore();
    new TrialPrefs(store).setOpponents(["apex"]);
    wipe(store);
    expect(new TrialPrefs(store).opponents()).toEqual([...DEFAULT_OPPONENTS]);
  });
});
