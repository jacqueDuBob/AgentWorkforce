import { NextResponse } from "next/server";
import { dismissCardFinding } from "@/lib/server/service";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const snapshot = dismissCardFinding(id, body);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update finding." },
      { status: 400 },
    );
  }
}
