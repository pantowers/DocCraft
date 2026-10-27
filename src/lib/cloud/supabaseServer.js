import { cookies } from "next/headers";

const ACCESS_COOKIE = "doccraft_access";
const REFRESH_COOKIE = "doccraft_refresh";

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) return null;
  } catch {
    return null;
  }
  return { url, anonKey };
}

function cookieOptions(maxAge) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge };
}

export async function storeSupabaseSession(session) {
  if (!session?.access_token || !session?.refresh_token) throw new Error("Sesi Supabase tidak lengkap.");
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, session.access_token, cookieOptions(Math.max(60, Number(session.expires_in) || 3600)));
  jar.set(REFRESH_COOKIE, session.refresh_token, cookieOptions(60 * 60 * 24 * 60));
}

export async function clearSupabaseSession() {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, "", cookieOptions(0));
  jar.set(REFRESH_COOKIE, "", cookieOptions(0));
}

async function fetchSupabaseUser(config, accessToken) {
  const response = await fetch(config.url + "/auth/v1/user", {
    headers: { apikey: config.anonKey, Authorization: "Bearer " + accessToken },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return response.json();
}

export async function getSupabaseSession() {
  const config = getSupabaseConfig();
  if (!config) return { configured: false, user: null, accessToken: null };
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value;
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (accessToken) {
    const user = await fetchSupabaseUser(config, accessToken);
    if (user) return { configured: true, user, accessToken };
  }
  if (!refreshToken) return { configured: true, user: null, accessToken: null };
  const response = await fetch(config.url + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) {
    await clearSupabaseSession();
    return { configured: true, user: null, accessToken: null };
  }
  const session = await response.json();
  if (!session.access_token || !session.user) {
    await clearSupabaseSession();
    return { configured: true, user: null, accessToken: null };
  }
  await storeSupabaseSession(session);
  return { configured: true, user: session.user, accessToken: session.access_token };
}

export async function requestSupabaseAuth(path, payload) {
  const config = getSupabaseConfig();
  if (!config) return { configured: false, response: null, body: null };
  const response = await fetch(config.url + path, {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  let body = {};
  try { body = await response.json(); } catch { /* The provider may return an empty error response. */ }
  return { configured: true, response, body };
}

export function authErrorMessage(body, fallback) {
  const message = body?.msg || body?.message || body?.error_description || body?.error;
  return typeof message === "string" ? message.slice(0, 240) : fallback;
}
