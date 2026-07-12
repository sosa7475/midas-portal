import { Router } from "express";
import multer from "multer";
import { DefineStrategyRequest, ParsedRules, TradeIdeaRequest } from "@midas/shared";
import { env } from "../env";
import { query } from "../db";
import { authenticate, type AuthedRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { processMessage } from "../agent";
import { chat } from "../services/llm";
import { ALLOWED_IMAGE_MIMES, saveImage } from "../services/storage";
import { getUserLlmKey } from "./settings";

const router = Router();
router.use(authenticate);

// Memory storage — buffer goes straight to the LLM; persisted copy goes to the volume.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_IMAGE_MIMES.includes(file.mimetype)),
});

router.post("/define", validateBody(DefineStrategyRequest), async (req, res) => {
  const { rulesText, name } = req.body as DefineStrategyRequest;
  const userId = (req as AuthedRequest).user.userId;

  try {
    // Parse rules with the LLM (best-effort — raw text is stored regardless).
    let parsedRules: ParsedRules | null = null;
    try {
      const userKey = await getUserLlmKey(userId);
      const parseResponse = await chat({
        messages: [
          {
            role: "user",
            content: `Parse this trading strategy into structured JSON rules. Extract: entry conditions, risk parameters, position sizing rules, exit rules, and any filters.

Strategy: "${rulesText}"

Return ONLY valid JSON in this schema:
{"entryConditions":[string],"riskPerTrade":string,"positionSizing":string,"stopLossRule":string,"takeProfitRule":string,"filters":[string],"notes":string}`,
          },
        ],
        systemPrompt: "You are a trading strategy parser. Return only valid JSON, no markdown.",
        apiKey: userKey?.apiKey ?? null,
        provider: userKey?.provider ?? null,
      });
      const jsonStr = parseResponse.content.replace(/```json|```/g, "").trim();
      parsedRules = ParsedRules.parse(JSON.parse(jsonStr));
    } catch {
      // Parsing failed; store raw text as-is.
    }

    await query("UPDATE strategies SET is_active = false WHERE user_id = $1", [userId]);
    const result = await query(
      `INSERT INTO strategies (user_id, name, rules_text, parsed_rules_json)
       VALUES ($1, $2, $3, $4) RETURNING id, name, rules_text, parsed_rules_json, created_at`,
      [userId, name ?? "My Strategy", rulesText, parsedRules ? JSON.stringify(parsedRules) : null]
    );
    const row = result.rows[0];
    res.json({
      strategy: {
        id: row.id,
        name: row.name,
        rulesText: row.rules_text,
        parsedRulesJson: row.parsed_rules_json,
        createdAt: row.created_at.toISOString(),
      },
    });
  } catch (err) {
    console.error("Strategy define error:", err);
    res.status(500).json({ error: "Failed to save strategy" });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, rules_text, parsed_rules_json, created_at FROM strategies
       WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
      [(req as AuthedRequest).user.userId]
    );
    const row = result.rows[0];
    res.json({
      strategy: row
        ? {
            id: row.id,
            name: row.name,
            rulesText: row.rules_text,
            parsedRulesJson: row.parsed_rules_json,
            createdAt: row.created_at.toISOString(),
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch strategy" });
  }
});

router.post("/analyze-screenshot", upload.single("screenshot"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Screenshot required (png/jpg/webp/gif)" });
  const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 2000) : null;
  const userId = (req as AuthedRequest).user.userId;

  try {
    const imageBase64 = req.file.buffer.toString("base64");
    const userMessage = notes
      ? `Analyze this chart screenshot. My notes: "${notes}". Does this match my strategy? What trade do you recommend?`
      : "Analyze this chart screenshot. Does it match my strategy? What trade do you recommend?";

    const userKey = await getUserLlmKey(userId);
    const [result, screenshotUrl] = await Promise.all([
      processMessage({
        userId,
        userMessage,
        imageBase64,
        imageMimeType: req.file.mimetype,
        userApiKey: userKey?.apiKey ?? null,
        userProvider: userKey?.provider ?? null,
      }),
      saveImage(req.file.buffer, req.file.mimetype).catch(() => null),
    ]);

    res.json({ ...result, screenshotUrl });
  } catch (err) {
    console.error("Screenshot analysis error:", err);
    res.status(500).json({ error: "Failed to analyze screenshot" });
  }
});

router.post("/trade-idea", validateBody(TradeIdeaRequest), async (req, res) => {
  const { idea } = req.body as TradeIdeaRequest;
  const userId = (req as AuthedRequest).user.userId;
  try {
    const userKey = await getUserLlmKey(userId);
    const result = await processMessage({
      userId,
      userMessage: idea,
      userApiKey: userKey?.apiKey ?? null,
      userProvider: userKey?.provider ?? null,
    });
    res.json(result);
  } catch (err) {
    console.error("Trade idea error:", err);
    res.status(500).json({ error: "Failed to process trade idea" });
  }
});

export default router;
