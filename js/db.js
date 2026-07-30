/**
 * db.js — Capa de almacenamiento persistente (IndexedDB)
 * Guarda todas las firmas del usuario (PNG importadas o dibujadas).
 * Todo el almacenamiento es 100% local, nunca sale del dispositivo.
 */
const SignatureDB = (() => {
  const DB_NAME = "pdf-signer-pro";
  const DB_VERSION = 1;
  const STORE = "signatures";

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode) {
    const db = await open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function uid() {
    return "sig_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  return {
    /**
     * Guarda una nueva firma.
     * @param {{name:string, dataUrl:string, width:number, height:number}} data
     */
    async add(data) {
      const store = await tx("readwrite");
      const record = {
        id: uid(),
        name: data.name || "Firma",
        dataUrl: data.dataUrl,
        width: data.width,
        height: data.height,
        createdAt: Date.now(),
      };
      return new Promise((resolve, reject) => {
        const req = store.add(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
      });
    },

    async getAll() {
      const store = await tx("readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => b.createdAt - a.createdAt);
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async rename(id, newName) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const rec = getReq.result;
          if (!rec) return resolve(null);
          rec.name = newName;
          const putReq = store.put(rec);
          putReq.onsuccess = () => resolve(rec);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });
    },

    async remove(id) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },

    async clearAll() {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },
  };
})();
