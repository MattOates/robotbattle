/**
 * Working out what was actually asked, before answering it.
 *
 * The assistant used to look up a lesson for every question, which produced
 * this, from a real session:
 *
 *     You:       can you see my script?
 *     Assistant: Let's add a sense cone to your robot!
 *                Your robot is now equipped with a sense cone.
 *
 * Neither sentence is true, and the path to them is short. "See" scores against
 * the sensing chapter, so a lesson about sense cones is pasted into the prompt;
 * the assistant is told to answer from the lesson quoted below; and it does.
 *
 * But "can you see my script" is not a question about RoboScript at all. It is
 * a question about the assistant, and answering it needs no lesson — only what
 * it was already told about itself. Retrieval was never the right default; it
 * is something to decide on.
 *
 * So one cheap call first, to sort the question. It costs a round trip, and it
 * buys the difference between answering the question and answering the index.
 */

import type { ChatMessage, ChatProvider } from "./provider.js";

/**
 * What kind of question this is.
 *
 * Four, because four is what the routing actually distinguishes: whether to
 * look up a lesson, and whether the script is relevant. More categories would
 * be more for a small model to get wrong without changing what happens next.
 */
export type QuestionKind = "language" | "script" | "assistant" | "other";

export interface Triage {
  kind: QuestionKind;
  /** What to look up, in the asker's own words. Empty when nothing should be. */
  topic: string;
}

export const TRIAGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["language", "script", "assistant", "other"],
    },
    topic: { type: "string" },
  },
  required: ["kind", "topic"],
};

/**
 * The sorting question.
 *
 * Deliberately says nothing about RoboScript. This call is about the shape of
 * the question and not its subject, and the language card would only give a
 * small model more to be distracted by.
 */
export function triageMessages(question: string, previous?: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Sort a question someone asked a helper inside a robot programming game.",
        "",
        'kind is "language" if they are asking how the RoboScript language works,',
        "  or what a command, event or word does.",
        'kind is "script" if they are asking about THEIR OWN robot or program —',
        "  what it does, what is wrong with it, why it will not work.",
        'kind is "assistant" if they are asking about YOU — what you can see, what',
        "  you are able to do, whether you can change things, who you are.",
        'kind is "other" for greetings, thanks, and anything else.',
        "",
        'topic is the two or three words worth looking up in a manual, when kind',
        '  is "language". Otherwise topic is an empty string.',
        "",
        // Descriptions alone sent almost everything to "assistant" — a small
        // model reads four paragraphs about itself and concludes the question
        // is about itself. Examples are what it actually follows.
        "Examples:",
        'Q: "what does chassis tank mean?" -> {"kind":"language","topic":"chassis tank"}',
        'Q: "how do I turn?" -> {"kind":"language","topic":"turning"}',
        'Q: "what is event.bearing?" -> {"kind":"language","topic":"bearing"}',
        'Q: "why does my robot never shoot?" -> {"kind":"script","topic":""}',
        'Q: "what is wrong with line 4?" -> {"kind":"script","topic":""}',
        // "What does my robot do when X" reads as a question about X and is
        // not one: the answer is in the handler in front of you. Sent to the
        // lessons, it came back describing dodging in general while the robot\'s
        // own `on hit by bullet` sat there unread.
        'Q: "what does my robot do when it gets shot?" -> {"kind":"script","topic":""}',
        'Q: "what is my robot called?" -> {"kind":"script","topic":""}',
        'Q: "does my robot ever fire?" -> {"kind":"script","topic":""}',
        'Q: "can you see my script?" -> {"kind":"assistant","topic":""}',
        'Q: "can you edit this for me?" -> {"kind":"assistant","topic":""}',
        'Q: "what do I need to change to avoid hills?" -> {"kind":"language","topic":"hills ground"}',
        'Q: "how do I make it dodge bullets?" -> {"kind":"language","topic":"dodging bullets"}',
        'Q: "what can I add to avoid hills?" -> {"kind":"language","topic":"hills ground"}',
        'Q: "can I use me.slope here?" -> {"kind":"language","topic":"slope"}',
        'Q: "thanks!" -> {"kind":"other","topic":""}',
        // Carried as context rather than as a turn to be sorted. Fed in as a
        // previous message, the sorter sorted THAT one instead — a follow-up to
        // "can you see my script?" came back as another question about the
        // assistant.
        ...(previous
          ? [
              "",
              `The question before this one was: "${previous}"`,
              "Sort the new question, using that only to fill in what it leaves out.",
            ]
          : []),
      ].join("\n"),
    },
    { role: "user", content: question },
  ];
}

export function parseTriage(text: string | null): Triage | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let body: unknown;
  try {
    body = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const kind = (body as Record<string, unknown>)["kind"];
  const topic = (body as Record<string, unknown>)["topic"];
  if (kind !== "language" && kind !== "script" && kind !== "assistant" && kind !== "other") {
    return null;
  }
  return { kind, topic: typeof topic === "string" ? topic.trim() : "" };
}

/**
 * Sort the question, falling back to treating it as a language question.
 *
 * The fallback is the old behaviour, which is the right thing to fail back to:
 * looking up a lesson for something that did not need one is a wasted paragraph,
 * whereas failing to look one up for a question that did need it is a wrong
 * answer. A misroute should cost the cheaper mistake.
 */
export async function triage(
  provider: ChatProvider,
  question: string,
  previous?: string,
): Promise<Triage> {
  try {
    const reply = await provider.chat({
      messages: triageMessages(question, previous),
      tools: [],
      json: { schema: TRIAGE_SCHEMA },
      // Sorting has one right answer; there is nothing to be gained by looking
      // for a different one.
      temperature: 0,
    });
    return parseTriage(reply.content) ?? { kind: "language", topic: question };
  } catch {
    return { kind: "language", topic: question };
  }
}
