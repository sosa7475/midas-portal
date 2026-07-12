/**
 * Provider-agnostic LLM adapter with real token streaming.
 * Defaults from env; per-user BYO keys override. Tool support is wired for
 * Phase 2's agentic loop.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { env } from "../env";

export interface LlmTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatParams {
  messages: { role: "user" | "assistant"; content: string }[];
  systemPrompt?: string;
  tools?: LlmTool[];
  apiKey?: string | null;
  provider?: "openai" | "anthropic" | null;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  /** Called with each streamed text delta. Omit for a single non-streamed call. */
  onDelta?: (delta: string) => void;
}

export interface ChatResult {
  type: "text" | "tool_use";
  content: string;
  toolCalls?: { id: string; name: string; input: unknown }[];
}

async function chatOpenAI(p: ChatParams): Promise<ChatResult> {
  const client = new OpenAI({ apiKey: p.apiKey || env.OPENAI_API_KEY });
  if (!p.apiKey && !env.OPENAI_API_KEY) throw new Error("No OpenAI API key configured");

  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (p.systemPrompt) messages.push({ role: "system", content: p.systemPrompt });
  p.messages.forEach((m, i) => {
    if (m.role === "user" && p.imageBase64 && i === p.messages.length - 1) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: m.content },
          {
            type: "image_url",
            image_url: { url: `data:${p.imageMimeType || "image/png"};base64,${p.imageBase64}` },
          },
        ],
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  });

  const tools = p.tools?.length
    ? p.tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))
    : undefined;

  if (p.onDelta && !tools) {
    const stream = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      stream: true,
    });
    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        full += delta;
        p.onDelta(delta);
      }
    }
    return { type: "text", content: full };
  }

  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages,
    ...(tools ? { tools, tool_choice: "auto" as const } : {}),
  });
  const choice = response.choices[0];
  if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
    return {
      type: "tool_use",
      content: choice.message.content ?? "",
      toolCalls: choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments) as unknown,
      })),
    };
  }
  return { type: "text", content: choice.message.content ?? "" };
}

async function chatAnthropic(p: ChatParams): Promise<ChatResult> {
  const client = new Anthropic({ apiKey: p.apiKey || env.ANTHROPIC_API_KEY });
  if (!p.apiKey && !env.ANTHROPIC_API_KEY) throw new Error("No Anthropic API key configured");

  const messages: Anthropic.MessageParam[] = p.messages.map((m, i) => {
    if (m.role === "user" && p.imageBase64 && i === p.messages.length - 1) {
      return {
        role: "user" as const,
        content: [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: (p.imageMimeType || "image/png") as
                | "image/png"
                | "image/jpeg"
                | "image/webp"
                | "image/gif",
              data: p.imageBase64,
            },
          },
          { type: "text" as const, text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const base: Anthropic.MessageCreateParamsNonStreaming = {
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages,
    ...(p.systemPrompt ? { system: p.systemPrompt } : {}),
    ...(p.tools?.length
      ? { tools: p.tools.map((t) => ({ ...t, input_schema: t.input_schema as Anthropic.Tool["input_schema"] })) }
      : {}),
  };

  if (p.onDelta && !p.tools?.length) {
    const stream = client.messages.stream(base);
    stream.on("text", (delta) => p.onDelta!(delta));
    const final = await stream.finalMessage();
    const text = final.content.find((b) => b.type === "text");
    return { type: "text", content: text?.type === "text" ? text.text : "" };
  }

  const response = await client.messages.create(base);
  if (response.stop_reason === "tool_use") {
    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const text = response.content.find((b) => b.type === "text");
    return {
      type: "tool_use",
      content: text?.type === "text" ? text.text : "",
      toolCalls: toolBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
    };
  }
  const text = response.content.find((b) => b.type === "text");
  return { type: "text", content: text?.type === "text" ? text.text : "" };
}

export async function chat(p: ChatParams): Promise<ChatResult> {
  const provider = p.provider || env.ACTIVE_LLM_PROVIDER;
  return provider === "anthropic" ? chatAnthropic(p) : chatOpenAI(p);
}
