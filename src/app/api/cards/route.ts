import { NextResponse } from "next/server";
import { createCard } from "@/lib/server/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const card = await createCard(body);
    return NextResponse.json({ card }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create card." },
      { status: 400 },
    );
  }
}
