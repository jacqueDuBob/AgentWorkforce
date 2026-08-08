import { NextResponse } from "next/server";
import { updateCard } from "@/lib/server/service";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const card = await updateCard(id, body);
    return NextResponse.json({ card });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update card." },
      { status: 400 },
    );
  }
}
