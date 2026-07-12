/** zod request validation — every route body/query is validated (BUILD_SPEC §5). */
import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return res.status(400).json({ error: `Invalid request: ${detail}` });
    }
    req.body = result.data;
    next();
  };
}
