import { NextResponse } from "next/server";
import { authErrorMessage, requestSupabaseAuth, storeSupabaseSession } from "@/lib/cloud/supabaseServer";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Data pendaftaran tidak valid." }, { status: 400 }); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Masukkan alamat email yang valid." }, { status: 400 });
  if (password.length < 8 || password.length > 128) return NextResponse.json({ error: "Kata sandi harus terdiri dari 8 sampai 128 karakter." }, { status: 400 });
  const result = await requestSupabaseAuth("/auth/v1/signup", { email, password });
  if (!result.configured) return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
  if (!result.response.ok) return NextResponse.json({ error: authErrorMessage(result.body, "Pendaftaran gagal.") }, { status: result.response.status });
  if (result.body.access_token && result.body.refresh_token) {
    await storeSupabaseSession(result.body);
    return NextResponse.json({ user: result.body.user ? { id: result.body.user.id, email: result.body.user.email } : null });
  }
  return NextResponse.json({ confirmationRequired: true });
}
