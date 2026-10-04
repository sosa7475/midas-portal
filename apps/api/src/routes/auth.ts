import { Router } from "express";
import bcrypt from "bcryptjs";
import { LoginRequest, RegisterRequest } from "@midas/shared";
import { query } from "../db";
import { signToken } from "../middleware/auth";
import { validateBody } from "../middleware/validate";

const router = Router();

router.post("/register", validateBody(RegisterRequest), async (req, res) => {
  const { email, password, displayName } = req.body as RegisterRequest;
  try {
    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3) RETURNING id, email, display_name`,
      [email.toLowerCase(), passwordHash, displayName ?? null]
    );
    const user = result.rows[0];
    const token = signToken({ userId: user.id, email: user.email });
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/login", validateBody(LoginRequest), async (req, res) => {
  const { email, password } = req.body as LoginRequest;
  try {
    const result = await query(
      "SELECT id, email, password_hash, display_name FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken({ userId: user.id, email: user.email });
    res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

export default router;
