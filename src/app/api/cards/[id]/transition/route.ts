import { NextResponse } from "next/server";
import { transitionCard } from "@/lib/server/service";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const snapshot = await transitionCard(id, body);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to transition card." },
      { status: 400 },
    );
  }
}
