import { z } from "zod";

export const LlmProvider = z.enum(["anthropic", "openai"]);
export type LlmProvider = z.infer<typeof LlmProvider>;

export const SaveApiKeyRequest = z.object({
  provider: LlmProvider,
  apiKey: z.string().min(8).max(512),
});
export type SaveApiKeyRequest = z.infer<typeof SaveApiKeyRequest>;

export const ApiKeysResponse = z.object({
  providers: z.array(
    z.object({
      provider: z.string(),
      label: z.string().nullable().optional(),
      createdAt: z.string().optional(),
    })
  ),
});
export type ApiKeysResponse = z.infer<typeof ApiKeysResponse>;
