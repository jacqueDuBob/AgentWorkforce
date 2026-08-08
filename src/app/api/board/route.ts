import { NextResponse } from "next/server";
import { getBoardSnapshot, resetDemoData } from "@/lib/server/service";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getBoardSnapshot());
}

export async function POST() {
  return NextResponse.json(await resetDemoData());
}
