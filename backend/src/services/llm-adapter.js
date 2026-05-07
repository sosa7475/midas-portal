/**
 * Provider-agnostic LLM adapter.
 * Defaults to OpenAI; set ACTIVE_LLM_PROVIDER env var to switch.
 * Supports: 'openai' | 'anthropic'
 */

const PROVIDER = process.env.ACTIVE_LLM_PROVIDER || 'openai';

// --- OpenAI provider ---
async function createOpenAIClient(apiKey) {
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
}

async function chatOpenAI({ messages, tools, apiKey, stream = false, imageBase64 = null, imageMimeType = null }) {
  const client = await createOpenAIClient(apiKey);
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  const formattedMessages = messages.map((m) => {
    if (m.role === 'user' && imageBase64 && messages.indexOf(m) === messages.length - 1) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          {
            type: 'image_url',
            image_url: { url: `data:${imageMimeType || 'image/png'};base64,${imageBase64}` },
          },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const params = {
    model,
    messages: formattedMessages,
    stream,
  };

  if (tools && tools.length > 0) {
    params.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    params.tool_choice = 'auto';
  }

  if (stream) {
    return client.chat.completions.stream(params);
  }

  const response = await client.chat.completions.create(params);
  const choice = response.choices[0];

  if (choice.finish_reason === 'tool_calls') {
    return {
      type: 'tool_use',
      tool_calls: choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      })),
    };
  }

  return { type: 'text', content: choice.message.content };
}

// --- Anthropic provider ---
async function chatAnthropic({ messages, tools, apiKey, stream = false, imageBase64 = null, imageMimeType = null, systemPrompt = null }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-7';

  const formattedMessages = messages.map((m, i) => {
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

  const params = {
    model,
    max_tokens: 4096,
    messages: formattedMessages,
  };
  if (systemPrompt) params.system = systemPrompt;
  if (tools && tools.length > 0) params.tools = tools;

  if (stream) {
    return client.messages.stream(params);
  }

  const response = await client.messages.create(params);
  if (response.stop_reason === 'tool_use') {
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    return { type: 'tool_use', tool_calls: [{ id: toolBlock.id, name: toolBlock.name, input: toolBlock.input }] };
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  return { type: 'text', content: textBlock?.text || '' };
}

// --- Unified interface ---
async function chat({ messages, tools = [], apiKey = null, provider = null, stream = false, imageBase64 = null, imageMimeType = null, systemPrompt = null }) {
  const activeProvider = provider || PROVIDER;
  if (activeProvider === 'anthropic') {
    return chatAnthropic({ messages, tools, apiKey, stream, imageBase64, imageMimeType, systemPrompt });
  }
  return chatOpenAI({ messages, tools, apiKey, stream, imageBase64, imageMimeType, systemPrompt });
}

// --- Streaming helper: collect full text from OpenAI stream ---
async function collectStream(stream, onChunk) {
  let fullText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) {
      fullText += delta;
      if (onChunk) onChunk(delta);
    }
  }
  return fullText;
}

module.exports = { chat, collectStream, PROVIDER };
