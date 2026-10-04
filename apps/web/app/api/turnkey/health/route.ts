import { NextResponse } from "next/server";
import { turnkeyReady, tkWhoami } from "../../../../lib/server/turnkey";

export const runtime = "nodejs";

// Confirms Turnkey env wiring works in the deployed environment (auth only — no wallet created).
export async function GET() {
  if (!turnkeyReady()) return NextResponse.json({ ready: false, note: "TURNKEY_* env vars not set" });
  try {
    const who = await tkWhoami();
    return NextResponse.json({ ready: true, connected: true,  });
  } catch (e) {
    return NextResponse.json({ ready: true, connected: false, error: e instanceof Error ? e.message : "whoami failed" }, { status: 200 });
  }
}
