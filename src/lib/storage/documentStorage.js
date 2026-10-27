import { openDB } from "idb";

const databaseName = "doccraft-local";
const storeName = "documents";
const folderStoreName = "folders";

function getDatabase() {
  if (typeof window === "undefined") return Promise.reject(new Error("Document storage is available in the browser only."));
  return openDB(databaseName, 2, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "id" });
      if (!database.objectStoreNames.contains(folderStoreName)) database.createObjectStore(folderStoreName, { keyPath: "id" });
    },
  });
}

export async function saveDocument(document) {
  const database = await getDatabase();
  await database.put(storeName, { ...document, updatedAt: new Date().toISOString() });
}

export async function getDocument(id) {
  const database = await getDatabase();
  return database.get(storeName, id);
}

export async function listDocuments() {
  const database = await getDatabase();
  return database.getAll(storeName);
}

export async function deleteDocument(id) {
  const database = await getDatabase();
  await database.delete(storeName, id);
}

export async function listFolders() {
  const database = await getDatabase();
  return database.getAll(folderStoreName);
}

export async function saveFolder(folder) {
  const database = await getDatabase();
  const saved = { ...folder, updatedAt: new Date().toISOString() };
  await database.put(folderStoreName, saved);
  return saved;
}

export async function moveDocumentToFolder(documentId, folderId) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const documents = transaction.objectStore(storeName);
  const document = await documents.get(documentId);
  if (!document) throw new Error("Dokumen tidak ditemukan.");
  await documents.put({ ...document, folderId: folderId || null, updatedAt: new Date().toISOString() });
  await transaction.done;
}

export async function deleteFolder(id) {
  const database = await getDatabase();
  const transaction = database.transaction([storeName, folderStoreName], "readwrite");
  const documents = transaction.objectStore(storeName);
  const savedDocuments = await documents.getAll();
  await Promise.all(savedDocuments.filter((document) => document.folderId === id).map((document) => documents.put({ ...document, folderId: null })));
  await transaction.objectStore(folderStoreName).delete(id);
  await transaction.done;
}

export async function restoreBackupRecords(documents, folders) {
  const database = await getDatabase();
  const transaction = database.transaction([storeName, folderStoreName], "readwrite");
  const documentStore = transaction.objectStore(storeName);
  const folderStore = transaction.objectStore(folderStoreName);
  const requests = [
    ...folders.map((folder) => folderStore.put(folder)),
    ...documents.map((document) => documentStore.put(document)),
  ];
  await Promise.all(requests);
  await transaction.done;
}
