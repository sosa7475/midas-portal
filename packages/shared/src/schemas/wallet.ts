import { z } from "zod";

export const ConnectWalletRequest = z.object({
  apiKey: z.string().min(8).max(512),
  apiSecret: z.string().min(8).max(512),
});
export type ConnectWalletRequest = z.infer<typeof ConnectWalletRequest>;

export const WalletBalance = z.object({
  totalCollateral: z.coerce.number().nullable().optional(),
  freeCollateral: z.coerce.number().nullable().optional(),
  holdings: z
    .array(z.object({ token: z.string(), holding: z.coerce.number() }).passthrough())
    .default([]),
});
export type WalletBalance = z.infer<typeof WalletBalance>;
