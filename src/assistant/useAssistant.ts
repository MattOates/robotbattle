/**
 * Whether to offer an assistant here at all.
 *
 * The answer needs a GPU adapter, so it cannot be had synchronously, and three
 * separate places need it — the Workshop, to decide whether the tray exists at
 * all; the settings panel, to decide whether any of its rows do; and the panel
 * itself. Asking three times would mean three adapter requests and three
 * chances to disagree with each other, so it is asked once and remembered.
 *
 * `null` while the answer is still coming. Callers should render nothing then
 * rather than guessing: a tray handle that appears and then vanishes a moment
 * later is worse than one that arrives a moment late.
 */

import { useEffect, useState } from "react";
import { assistantRuntime } from "./runtime.js";

let asked: Promise<boolean> | null = null;

function usable(): Promise<boolean> {
  const runtime = assistantRuntime();
  if (!runtime) return Promise.resolve(false);
  asked ??= runtime.capability().then((c) => c.ok);
  return asked;
}

export function useAssistantUsable(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void usable().then((value) => {
      if (!cancelled) setOk(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ok;
}
