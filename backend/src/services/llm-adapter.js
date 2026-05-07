/**
 * Provider-agnostic LLM adapter.
 * Defaults to OpenAI; set ACTIVE_LLM_PROVIDER env var to switch.
 * Supports: 'openai' | 'anthropic'
 *
 * Tool-calling contract (uniform across providers):
 *   Response is always one of:
 *     { type: 'text', content: string }
 *     { type: 'tool_use', toolCalls: [{ id, name, input }], assistantMessage }
 *   `assistantMessage` is the raw provider message to append before tool_result
 *   blocks so the next turn keeps multi-turn tool conversations consistent.
 */

const PROVIDER = process.env.ACTIVE_LLM_PROVIDER || 'openai';

// --- OpenAI provider ---
async function createOpenAIClient(apiKey) {
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
}

function formatOpenAIMessages(messages, imageBase64, imageMimeType) {
  return messages.map((m, i) => {
    if (m.role === 'user' && imageBase64 && i === messages.length - 1 && typeof m.content === 'string') {
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          { type: 'image_url', image_url: { url: `data:${imageMimeType || 'image/png'};base64,${imageBase64}` } },
        ],
      };
    }
    return m;
  });
}

async function chatOpenAI({ messages, tools, apiKey, stream = false, imageBase64 = null, imageMimeType = null, systemPrompt = null }) {
  const client = await createOpenAIClient(apiKey);
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  const sysMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
  const formatted = [...sysMessages, ...formatOpenAIMessages(messages, imageBase64, imageMimeType)];

  const params = { model, messages: formatted, stream };
  if (tools && tools.length > 0) {
    params.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    params.tool_choice = 'auto';
  }

  if (stream) return client.chat.completions.stream(params);

  const response = await client.chat.completions.create(params);
  const choice = response.choices[0];

  if (choice.finish_reason === 'tool_calls') {
    return {
      type: 'tool_use',
      toolCalls: choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: safeJson(tc.function.arguments),
      })),
      assistantMessage: choice.message, // OpenAI message object; append directly
      raw: choice,
    };
  }

  return { type: 'text', content: choice.message.content || '', raw: choice };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// --- Anthropic provider ---
async function chatAnthropic({ messages, tools, apiKey, stream = false, imageBase64 = null, imageMimeType = null, systemPrompt = null }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-7';

  const formatted = messages.map((m, i) => {
    // Pass through pre-shaped multi-block messages (from tool-result turns)
    if (Array.isArray(m.content)) return m;
    if (m.role === 'user' && imageBase64 && i === messages.length - 1) {
      return {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageMimeType || 'image/png', data: imageBase64 } },
          { type: 'text', text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const params = { model, max_tokens: 4096, messages: formatted };
  if (systemPrompt) params.system = systemPrompt;
  if (tools && tools.length > 0) params.tools = tools;

  if (stream) return client.messages.stream(params);

  const response = await client.messages.create(params);
  if (response.stop_reason === 'tool_use') {
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use');
    return {
      type: 'tool_use',
      toolCalls: toolBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
      assistantMessage: { role: 'assistant', content: response.content },
      raw: response,
    };
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  return { type: 'text', content: textBlock?.text || '', raw: response };
}

// --- Tool-result message builders (provider-aware) -----------------

function buildToolResultMessage(toolCalls, results, provider) {
  const active = provider || PROVIDER;
  if (active === 'anthropic') {
    return {
      role: 'user',
      content: toolCalls.map((tc, i) => ({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: typeof results[i] === 'string' ? results[i] : JSON.stringify(results[i]),
        is_error: results[i]?.__error === true,
      })),
    };
  }
  // OpenAI: one message per tool call with role 'tool'
  return toolCalls.map((tc, i) => ({
    role: 'tool',
    tool_call_id: tc.id,
    content: typeof results[i] === 'string' ? results[i] : JSON.stringify(results[i]),
  }));
}

// --- Unified interface ---
async function chat({ messages, tools = [], apiKey = null, provider = null, stream = false, imageBase64 = null, imageMimeType = null, systemPrompt = null }) {
  const active = provider || PROVIDER;
  if (active === 'anthropic') {
    return chatAnthropic({ messages, tools, apiKey, stream, imageBase64, imageMimeType, systemPrompt });
  }
  return chatOpenAI({ messages, tools, apiKey, stream, imageBase64, imageMimeType, systemPrompt });
}

async function collectStream(stream, onChunk) {
  let fullText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) { fullText += delta; if (onChunk) onChunk(delta); }
  }
  return fullText;
}

module.exports = { chat, collectStream, buildToolResultMessage, PROVIDER };
