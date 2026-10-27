import { NextResponse } from "next/server";
import { getSupabaseConfig, getSupabaseSession, storeSupabaseSession } from "@/lib/cloud/supabaseServer";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSupabaseSession();
  return NextResponse.json({ configured: session.configured, user: session.user ? { id: session.user.id, email: session.user.email } : null });
}

export async function POST(request) {
  const config = getSupabaseConfig();
  if (!config) return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Data sesi tidak valid." }, { status: 400 }); }
  if (typeof body?.access_token !== "string" || typeof body?.refresh_token !== "string") return NextResponse.json({ error: "Token sesi tidak lengkap." }, { status: 400 });
  const response = await fetch(config.url + "/auth/v1/user", {
    headers: { apikey: config.anonKey, Authorization: "Bearer " + body.access_token },
    cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ error: "Tautan verifikasi tidak valid atau sudah kedaluwarsa." }, { status: 401 });
  const user = await response.json();
  await storeSupabaseSession({ access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in, user });
  return NextResponse.json({ user: { id: user.id, email: user.email } });
}
