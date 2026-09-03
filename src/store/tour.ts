/**
 * Where each guided tour has got to.
 *
 * Deliberately stores the current *step* rather than a boolean. A tour is a
 * dozen steps long and someone will reload in the middle of one — with a flag
 * that reload either restarts the tour from the top or loses it entirely, and
 * both are worse than resuming. The step id is the only thing that makes the
 * middle of a tour a place you can come back to.
 *
 * The mute setting lives here too rather than in the profile, because it is a
 * property of the tours and not of the player: someone who mutes the tour has
 * not said anything about the rest of the game.
 */

import { defaultStore, readJson, writeJson, type KeyValueStore } from "./storage.js";

const KEY = "tours";

export type TourId = "workshop" | "arena" | "tournament";

/**
 * `unseen` has never been offered, `skipped` was declined or abandoned, `done`
 * was finished, and a bare step id means it is part-way through.
 *
 * A string union rather than an object because it is written to storage and
 * read back by a future version of this code; the flatter it is, the less
 * there is to migrate.
 */
export type TourState = "unseen" | "skipped" | "done" | { step: string };

interface Stored {
  tours?: Partial<Record<TourId, string>>;
  muted?: boolean;
  /** Whether a match is narrated. Off until asked for; see `Settings`. */
  commentary?: boolean;
}

/** Storage holds a plain string; only `unseen` is absent rather than stored. */
function parse(raw: string | undefined): TourState {
  if (raw === undefined) return "unseen";
  if (raw === "skipped" || raw === "done") return raw;
  return { step: raw };
}

function serialise(state: TourState): string {
  return typeof state === "string" ? state : state.step;
}

export class Tours {
  private store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.store = store;
  }

  private all(): Stored {
    return readJson<Stored>(this.store, KEY, {});
  }

  private write(next: Stored): void {
    writeJson(this.store, KEY, next);
  }

  state(id: TourId): TourState {
    return parse(this.all().tours?.[id]);
  }

  /** Has this tour been settled one way or the other? */
  isSettled(id: TourId): boolean {
    const state = this.state(id);
    return state === "done" || state === "skipped";
  }

  private set(id: TourId, state: TourState): void {
    const current = this.all();
    this.write({ ...current, tours: { ...current.tours, [id]: serialise(state) } });
  }

  begin(id: TourId, firstStep: string): void {
    this.set(id, { step: firstStep });
  }

  advanceTo(id: TourId, stepId: string): void {
    this.set(id, { step: stepId });
  }

  skip(id: TourId): void {
    this.set(id, "skipped");
  }

  finish(id: TourId): void {
    this.set(id, "done");
  }

  muted(): boolean {
    return this.all().muted === true;
  }

  /**
   * Is a match narrated?
   *
   * Off unless somebody says otherwise, and deliberately so: switching it on
   * is what fetches a second voice, and a lobby with other people waiting is
   * the worst possible place to be stuck behind a download nobody asked for.
   */
  commentary(): boolean {
    return this.all().commentary === true;
  }

  /** The stored choice, or null when this level's default should decide. */
  commentaryPreference(): boolean | null {
    const value = this.all().commentary;
    return typeof value === "boolean" ? value : null;
  }

  setCommentary(on: boolean): void {
    this.write({ ...this.all(), commentary: on });
  }

  setMuted(muted: boolean): void {
    this.write({ ...this.all(), muted });
  }

  /** Offer every tour again. Keeps the preferences, which are not progress. */
  reset(): void {
    const current = this.all();
    this.write({
      muted: current.muted === true,
      ...(typeof current.commentary === "boolean" ? { commentary: current.commentary } : {}),
    });
  }
}
