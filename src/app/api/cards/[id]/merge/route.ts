import { NextResponse } from "next/server";
import { mergeCard } from "@/lib/server/service";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const snapshot = await mergeCard(id);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to merge card." },
      { status: 400 },
    );
  }
}
