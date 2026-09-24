"use strict";

const DEVICE_SESSION_DB = "school-tools-v2-device-session";
const DEVICE_SESSION_STORE = "auth";
const DEVICE_CREDENTIAL_KEY = "deviceCredential";

function openDeviceSessionDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb || typeof indexedDb.open !== "function") {
    return Promise.reject(new Error("indexeddb_unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DEVICE_SESSION_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DEVICE_SESSION_STORE)) {
        database.createObjectStore(DEVICE_SESSION_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("indexeddb_open_failed"));
    request.onblocked = () => reject(new Error("indexeddb_blocked"));
  });
}

async function withDeviceSessionStore(mode, operation, indexedDb = globalThis.indexedDB) {
  const database = await openDeviceSessionDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DEVICE_SESSION_STORE, mode);
      const store = transaction.objectStore(DEVICE_SESSION_STORE);
      let result;
      try { result = operation(store); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(new Error("indexeddb_transaction_failed"));
      transaction.onabort = () => reject(new Error("indexeddb_transaction_aborted"));
    });
  } finally {
    database.close();
  }
}

async function getDeviceCredential(indexedDb) {
  const value = await withDeviceSessionStore(
    "readonly",
    (store) => store.get(DEVICE_CREDENTIAL_KEY),
    indexedDb
  );
  return typeof value === "string" && value.length <= 128 ? value : null;
}

async function saveDeviceCredential(credential, indexedDb) {
  if (typeof credential !== "string" || !credential || credential.length > 128) {
    throw new Error("invalid_device_credential");
  }
  await withDeviceSessionStore(
    "readwrite",
    (store) => store.put(credential, DEVICE_CREDENTIAL_KEY),
    indexedDb
  );
}

async function clearDeviceCredential(indexedDb) {
  try {
    await withDeviceSessionStore(
      "readwrite",
      (store) => store.delete(DEVICE_CREDENTIAL_KEY),
      indexedDb
    );
  } catch {
    // Clearing local authentication state is best-effort when storage itself is unavailable.
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    DEVICE_CREDENTIAL_KEY,
    DEVICE_SESSION_DB,
    DEVICE_SESSION_STORE,
    clearDeviceCredential,
    getDeviceCredential,
    openDeviceSessionDatabase,
    saveDeviceCredential
  };
}
