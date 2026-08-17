import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchRunnerOutbox } from "@/lib/server-job-queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.FLOWBOARD_OUTBOX_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const authorized = expected.length >= 32 && supplied.length === expected.length
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!authorized) return NextResponse.json({ error: "Invalid outbox dispatcher token." }, { status: 401 });
  try { await dispatchRunnerOutbox(); return NextResponse.json({ ok: true }); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Outbox dispatch failed." }, { status: 500 }); }
}
