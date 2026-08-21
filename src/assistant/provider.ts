/**
 * The seam between the assistant and whatever is actually doing the thinking.
 *
 * These types are a deliberate re-declaration of the slice of the OpenAI
 * chat-completions API we use, rather than a re-export of WebLLM's copy. WebLLM
 * runs the model in this browser today, but the whole point of picking that
 * shape is that a player could one day paste in an API key and point the same
 * assistant at a hosted model. A provider that talks to a URL should not have
 * to pull in a WebGPU inference engine to learn what a message looks like.
 *
 * So: everything above this file speaks OpenAI. Everything below it is a detail.
 */

export type Role = "system" | "user" | "assistant" | "tool";

/** A function call the model asked for, in OpenAI's shape. */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON, as a string — the model writes it, so it may not parse. */
    arguments: string;
  };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  /** Set on an assistant turn that asked for functions to be run. */
  tool_calls?: ToolCall[];
  /** Set on a `tool` turn, naming the call it answers. */
  tool_call_id?: string;
}

/** A function the model may call. `parameters` is JSON Schema. */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools: ToolDef[];
  temperature?: number;
}

export interface ChatResponse {
  /** Prose, when the provider allows any. Grammar-constrained ones never do. */
  content: string | null;
  tool_calls: ToolCall[];
  finishReason: string;
}

export interface ChatProvider {
  /** The model behind this provider, for display. */
  readonly id: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  dispose(): void;
}
