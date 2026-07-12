import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { env } from "../env";

export interface AuthedRequest extends Request {
  user: { userId: string; email: string };
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization token" });
  }
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as {
      userId: string;
      email: string;
    };
    (req as AuthedRequest).user = { userId: payload.userId, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function signToken(payload: { userId: string; email: string }) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}
