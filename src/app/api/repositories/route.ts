import { NextResponse } from "next/server";
import { getBoardSnapshot } from "@/lib/server/service";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ repositories: (await getBoardSnapshot()).repositories });
}
