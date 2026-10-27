import { NextResponse } from "next/server";
import { clearSupabaseSession, getSupabaseConfig, getSupabaseSession } from "@/lib/cloud/supabaseServer";

export const runtime = "nodejs";

export async function POST() {
  const config = getSupabaseConfig();
  const session = await getSupabaseSession();
  if (config && session.accessToken) {
    await fetch(config.url + "/auth/v1/logout", { method: "POST", headers: { apikey: config.anonKey, Authorization: "Bearer " + session.accessToken }, cache: "no-store" });
  }
  await clearSupabaseSession();
  return NextResponse.json({ ok: true });
}
