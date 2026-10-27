import { NextResponse } from "next/server";
import { getSupabaseConfig, getSupabaseSession } from "@/lib/cloud/supabaseServer";
import { validateDocument } from "@/lib/document/validation";

export const runtime = "nodejs";
const TABLES = ["doccraft_documents", "doccraft_folders"];
const MAX_BODY_BYTES = 30 * 1024 * 1024;

function restHeaders(config, token, extra = {}) {
  return { apikey: config.anonKey, Authorization: "Bearer " + token, "Content-Type": "application/json", ...extra };
}

function tableUrl(config, table, suffix = "") {
  return config.url + "/rest/v1/" + table + suffix;
}

async function restRequest(config, token, table, method, body) {
  const url = method === "GET"
    ? tableUrl(config, table, "?select=id,payload,updated_at&order=updated_at.desc")
    : tableUrl(config, table, "?on_conflict=user_id,id");
  const response = await fetch(url, {
    method,
    headers: restHeaders(config, token, method === "GET" ? {} : { Prefer: "resolution=merge-duplicates,return=minimal" }),
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error("Penyimpanan Supabase menolak permintaan (" + response.status + "): " + details);
  }
  return method === "GET" ? response.json() : null;
}

async function deleteRows(config, token, table, ids) {
  if (!ids.length) return;
  const filter = new URLSearchParams({ select: "id" });
  filter.set("id", "in.(" + ids.join(",") + ")");
  const response = await fetch(tableUrl(config, table, "?" + filter.toString()), {
    method: "DELETE",
    headers: restHeaders(config, token, { Prefer: "return=minimal" }),
    cache: "no-store",
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error("Penghapusan cloud gagal (" + response.status + "): " + details);
  }
}

export async function GET() {
  const config = getSupabaseConfig();
  if (!config) return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
  const session = await getSupabaseSession();
  if (!session.user) return NextResponse.json({ error: "Silakan masuk kembali." }, { status: 401 });
  try {
    const [documents, folders] = await Promise.all([
      restRequest(config, session.accessToken, TABLES[0], "GET"),
      restRequest(config, session.accessToken, TABLES[1], "GET"),
    ]);
    return NextResponse.json({
      documents: documents.map((row) => ({ item: row.payload, syncedAt: row.updated_at })),
      folders: folders.map((row) => ({ item: row.payload, syncedAt: row.updated_at })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data cloud tidak dapat dimuat." }, { status: 502 });
  }
}

export async function PUT(request) {
  const config = getSupabaseConfig();
  if (!config) return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
  const session = await getSupabaseSession();
  if (!session.user) return NextResponse.json({ error: "Silakan masuk kembali." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Data sinkronisasi melebihi batas 30 MB." }, { status: 413 });
  let text;
  try { text = await request.text(); } catch { return NextResponse.json({ error: "Data sinkronisasi tidak dapat dibaca." }, { status: 400 }); }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Data sinkronisasi melebihi batas 30 MB." }, { status: 413 });
  let body;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Format data sinkronisasi tidak valid." }, { status: 400 }); }
  if (!Array.isArray(body?.documents) || !Array.isArray(body?.folders) || body.documents.length > 500 || body.folders.length > 500) {
    return NextResponse.json({ error: "Daftar dokumen atau folder tidak valid (maksimal 500 masing-masing)." }, { status: 400 });
  }
  for (const document of body.documents) {
    const result = validateDocument(document);
    if (!result.valid) return NextResponse.json({ error: "Dokumen cloud tidak valid: " + result.errors[0] }, { status: 400 });
  }
  for (const folder of body.folders) {
    if (!folder || typeof folder.id !== "string" || !folder.id || typeof folder.name !== "string" || !folder.name.trim()) {
      return NextResponse.json({ error: "Ada data folder yang tidak valid." }, { status: 400 });
    }
  }
  const now = new Date().toISOString();
  const rowsFor = (items) => items.map((payload) => ({ user_id: session.user.id, id: payload.id, payload, updated_at: now }));
  try {
    await Promise.all([
      body.documents.length ? restRequest(config, session.accessToken, TABLES[0], "POST", rowsFor(body.documents)) : null,
      body.folders.length ? restRequest(config, session.accessToken, TABLES[1], "POST", rowsFor(body.folders)) : null,
    ]);
    return NextResponse.json({ savedDocuments: body.documents.length, savedFolders: body.folders.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data cloud gagal disimpan." }, { status: 502 });
  }
}

export async function DELETE(request) {
  const config = getSupabaseConfig();
  if (!config) return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
  const session = await getSupabaseSession();
  if (!session.user) return NextResponse.json({ error: "Silakan masuk kembali." }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Data penghapusan tidak valid." }, { status: 400 }); }
  const validIds = (items) => Array.isArray(items) && items.length <= 500 && items.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(id));
  if (!validIds(body?.documentIds) || !validIds(body?.folderIds)) return NextResponse.json({ error: "Daftar ID penghapusan tidak valid." }, { status: 400 });
  try {
    await Promise.all([
      deleteRows(config, session.accessToken, TABLES[0], body.documentIds),
      deleteRows(config, session.accessToken, TABLES[1], body.folderIds),
    ]);
    return NextResponse.json({ deletedDocuments: body.documentIds.length, deletedFolders: body.folderIds.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Penghapusan cloud gagal." }, { status: 502 });
  }
}
