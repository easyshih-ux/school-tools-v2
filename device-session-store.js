"use strict";

const DEVICE_SESSION_DB = "school-tools-v2-device-session";
const DEVICE_SESSION_STORE = "auth";
const DEVICE_CREDENTIAL_KEY = "deviceCredential";
const DEVICE_CREDENTIAL_FALLBACK_KEY = "school-tools-device-credential";

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

function validCredential(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function fallbackStorage(storage = globalThis.localStorage) {
  return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function"
    ? storage
    : null;
}

async function getDeviceCredential(indexedDb = globalThis.indexedDB, storage = globalThis.localStorage) {
  try {
    const value = await withDeviceSessionStore(
      "readonly",
      (store) => store.get(DEVICE_CREDENTIAL_KEY),
      indexedDb
    );
    if (validCredential(value)) return value;
  } catch {
    // Some installed browser shells block IndexedDB; use same-origin persistent storage below.
  }
  try {
    const value = fallbackStorage(storage)?.getItem(DEVICE_CREDENTIAL_FALLBACK_KEY);
    return validCredential(value) ? value : null;
  } catch {
    return null;
  }
}

async function saveDeviceCredential(credential, indexedDb = globalThis.indexedDB, storage = globalThis.localStorage) {
  if (!validCredential(credential)) throw new Error("invalid_device_credential");
  let saved = false;
  try {
    await withDeviceSessionStore(
      "readwrite",
      (store) => store.put(credential, DEVICE_CREDENTIAL_KEY),
      indexedDb
    );
    saved = true;
  } catch {
    // Continue to the persistent fallback used by installed browser shells.
  }
  try {
    const fallback = fallbackStorage(storage);
    if (fallback) {
      fallback.setItem(DEVICE_CREDENTIAL_FALLBACK_KEY, credential);
      saved = true;
    }
  } catch {
    // IndexedDB may still have saved the credential.
  }
  if (!saved) throw new Error("device_credential_storage_unavailable");
}

async function clearDeviceCredential(indexedDb = globalThis.indexedDB, storage = globalThis.localStorage) {
  try {
    await withDeviceSessionStore(
      "readwrite",
      (store) => store.delete(DEVICE_CREDENTIAL_KEY),
      indexedDb
    );
  } catch {
    // Clearing local authentication state is best-effort when storage itself is unavailable.
  }
  try { fallbackStorage(storage)?.removeItem(DEVICE_CREDENTIAL_FALLBACK_KEY); } catch { /* best effort */ }
}

if (typeof module !== "undefined") {
  module.exports = {
    DEVICE_CREDENTIAL_KEY,
    DEVICE_CREDENTIAL_FALLBACK_KEY,
    DEVICE_SESSION_DB,
    DEVICE_SESSION_STORE,
    clearDeviceCredential,
    getDeviceCredential,
    openDeviceSessionDatabase,
    saveDeviceCredential
  };
}
