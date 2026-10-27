"use client";

import { useEffect, useState } from "react";
import { Cloud, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { deleteDocument, deleteFolder, listDocuments, listFolders, saveDocument, saveFolder } from "@/lib/storage/documentStorage";
import { validateDocument } from "@/lib/document/validation";

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Permintaan cloud gagal.");
  return body;
}

function itemVersion(item) {
  return String(item?.updatedAt ?? "");
}

function planRecords(localItems, remoteRows, knownVersions = {}) {
  const localById = new Map(localItems.map((item) => [item.id, item]));
  const remoteById = new Map(remoteRows.map((row) => [row.item.id, row.item]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const finalItems = [];
  const upload = [];
  const download = [];
  const deleteLocal = [];
  const deleteCloud = [];
  for (const id of ids) {
    const local = localById.get(id);
    const cloud = remoteById.get(id);
    const lastVersion = knownVersions[id];
    if (local && cloud) {
      if ((Date.parse(local.updatedAt) || 0) >= (Date.parse(cloud.updatedAt) || 0)) { finalItems.push(local); upload.push(local); }
      else { finalItems.push(cloud); download.push(cloud); }
    } else if (local) {
      if (lastVersion && itemVersion(local) === lastVersion) deleteLocal.push(local);
      else { finalItems.push(local); upload.push(local); }
    } else if (cloud) {
      if (lastVersion && itemVersion(cloud) === lastVersion) deleteCloud.push(cloud);
      else { finalItems.push(cloud); download.push(cloud); }
    }
  }
  return { finalItems, upload, download, deleteLocal, deleteCloud };
}

function loadSyncManifest(userId) {
  try { return JSON.parse(localStorage.getItem("doccraft-cloud-sync:" + userId) || "{}"); }
  catch { return {}; }
}

async function deleteCloudInBatches(documents, folders) {
  const documentIds = documents.map((item) => item.id);
  const folderIds = folders.map((item) => item.id);
  const count = Math.max(Math.ceil(documentIds.length / 500), Math.ceil(folderIds.length / 500));
  for (let index = 0; index < count; index += 1) {
    await readJson(await fetch("/api/cloud/documents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ documentIds: documentIds.slice(index * 500, (index + 1) * 500), folderIds: folderIds.slice(index * 500, (index + 1) * 500) }),
    }));
  }
}

async function pushInBatches(documents, folders) {
  const records = [
    ...documents.map((item) => ({ kind: "document", item })),
    ...folders.map((item) => ({ kind: "folder", item })),
  ];
  let index = 0;
  while (index < records.length) {
    const batch = { documents: [], folders: [] };
    let size = 2;
    while (index < records.length && (batch.documents.length + batch.folders.length) < 100) {
      const record = records[index];
      const encodedSize = JSON.stringify(record.item).length;
      if (encodedSize > 25 * 1024 * 1024) throw new Error("Satu dokumen melebihi batas sinkronisasi 25 MB.");
      if (size + encodedSize > 25 * 1024 * 1024 && size > 2) break;
      batch[record.kind === "document" ? "documents" : "folders"].push(record.item);
      size += encodedSize;
      index += 1;
    }
    await readJson(await fetch("/api/cloud/documents", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(batch),
    }));
  }
}

export default function CloudAccountPanel() {
  const [configured, setConfigured] = useState(null);
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refreshSession() {
    const session = await readJson(await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" }));
    setConfigured(session.configured);
    setUser(session.user);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken && refreshToken) {
          const response = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: params.get("expires_in") }),
          });
          await readJson(response);
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
        const session = await readJson(await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" }));
        if (active) {
          setConfigured(session.configured);
          setUser(session.user);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Sesi akun tidak dapat diperiksa.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const result = await readJson(await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      }));
      setPassword("");
      if (result.confirmationRequired) {
        setMessage("Akun dibuat. Periksa email untuk verifikasi, lalu masuk kembali.");
        return;
      }
      await refreshSession();
      setMessage(mode === "signup" ? "Akun berhasil dibuat." : "Berhasil masuk.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Autentikasi gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await readJson(await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }));
      setUser(null);
      setMessage("Keluar dari akun. Dokumen lokal tetap tersimpan di browser ini.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tidak dapat keluar dari akun.");
    } finally {
      setBusy(false);
    }
  }

  async function syncCloud() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const [localDocuments, localFolders] = await Promise.all([listDocuments(), listFolders()]);
      const manifestKey = "doccraft-cloud-sync:" + user.id;
      const manifest = loadSyncManifest(user.id);
      if (!localStorage.getItem(manifestKey) && !window.confirm("Sinkronisasi pertama akan menggabungkan semua dokumen dan folder lokal di browser ini dengan akun " + user.email + ". Lanjutkan?")) return;
      const remote = await readJson(await fetch("/api/cloud/documents", { credentials: "same-origin", cache: "no-store" }));
      const docs = planRecords(localDocuments, remote.documents ?? [], manifest.documents ?? {});
      const folders = planRecords(localFolders, remote.folders ?? [], manifest.folders ?? {});
      await deleteCloudInBatches(docs.deleteCloud, folders.deleteCloud);
      for (const document of docs.download) {
        const validation = validateDocument(document);
        if (!validation.valid) throw new Error("Dokumen cloud tidak valid: " + validation.errors[0]);
        await saveDocument(document);
      }
      for (const folder of folders.download) await saveFolder(folder);
      await pushInBatches(docs.upload, folders.upload);
      for (const document of docs.deleteLocal) await deleteDocument(document.id);
      for (const folder of folders.deleteLocal) await deleteFolder(folder.id);
      localStorage.setItem(manifestKey, JSON.stringify({
        documents: Object.fromEntries(docs.finalItems.map((item) => [item.id, itemVersion(item)])),
        folders: Object.fromEntries(folders.finalItems.map((item) => [item.id, itemVersion(item)])),
        syncedAt: new Date().toISOString(),
      }));
      setMessage("Sinkronisasi selesai: " + docs.finalItems.length + " dokumen dan " + folders.finalItems.length + " folder tersedia di akun ini.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sinkronisasi gagal.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="dashboard-cloud-panel">
    <summary><span className="dashboard-cloud-panel__title"><Cloud size={17} /> Akun dan sinkronisasi cloud</span><span className="dashboard-cloud-panel__status">{user ? user.email : configured === false ? "Belum dikonfigurasi" : configured ? "Tidak masuk" : "Memeriksa..."}</span></summary>
    <div className="dashboard-cloud-panel__body">
      <p>Dokumen dan folder dapat dicadangkan ke akun pribadimu lalu dipulihkan di perangkat lain. Sinkronisasi dilakukan saat kamu menekan tombol; perubahan lokal tidak dikirim otomatis. Akun lain tidak dapat melihat data akun ini.</p>
      <p className="dashboard-cloud-panel__privacy"><ShieldCheck size={15} /> Sesi memakai cookie HttpOnly dan kebijakan database membatasi data berdasarkan akun.</p>
      {configured === false ? <div className="dashboard-cloud-panel__setup" role="status">Supabase belum dihubungkan. Salin .env.example menjadi .env.local, isi URL dan publishable/anon key Supabase, jalankan SQL di folder supabase, lalu mulai ulang server.</div> : null}
      {error ? <div className="dashboard-cloud-panel__error" role="alert">{error}</div> : null}
      {message ? <div className="dashboard-cloud-panel__message" role="status">{message}</div> : null}
      {user ? <div className="dashboard-cloud-panel__actions"><span><UserRound size={15} /> Masuk sebagai {user.email}</span><button type="button" className="button button--primary" onClick={syncCloud} disabled={busy}><RefreshCw size={15} /> {busy ? "Memproses..." : "Sinkronkan sekarang"}</button><button type="button" className="button button--secondary" onClick={logout} disabled={busy}>Keluar</button></div> : <form className="dashboard-cloud-panel__form" onSubmit={submitAuth}>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Kata sandi<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div className="dashboard-cloud-panel__actions"><button type="submit" className="button button--primary" disabled={busy || configured === false}>{busy ? "Memproses..." : mode === "signup" ? "Buat akun" : "Masuk"}</button><button type="button" className="button button--secondary" onClick={() => { setMode((value) => value === "login" ? "signup" : "login"); setError(""); setMessage(""); }}>{mode === "signup" ? "Sudah punya akun? Masuk" : "Buat akun baru"}</button></div>
      </form>}
    </div>
  </details>;
}
