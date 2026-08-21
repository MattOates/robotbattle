/**
 * Runs the language model off the UI thread.
 *
 * Same reason as the test bench next door: generation is seconds of solid GPU
 * and CPU work, and on the main thread it would stutter the editor the player
 * is watching the assistant type into.
 *
 * The import is static, but this file is still only fetched when somebody
 * constructs the worker — which happens when they press the download button and
 * not before. The inference engine is by far the largest dependency here, and
 * everyone who never opens the assistant pays nothing for it.
 */

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};
