import { NextResponse } from "next/server";
import { authErrorMessage, requestSupabaseAuth, storeSupabaseSession } from "@/lib/cloud/supabaseServer";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Data masuk tidak valid." }, { status: 400 }); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password || password.length > 128) return NextResponse.json({ error: "Email atau kata sandi belum lengkap." }, { status: 400 });
  const result = await requestSupabaseAuth("/auth/v1/token?grant_type=password", { email, password });
  if (!result.configured) return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
  if (!result.response.ok) return NextResponse.json({ error: authErrorMessage(result.body, "Email atau kata sandi tidak cocok.") }, { status: result.response.status });
  await storeSupabaseSession(result.body);
  return NextResponse.json({ user: { id: result.body.user.id, email: result.body.user.email } });
}
