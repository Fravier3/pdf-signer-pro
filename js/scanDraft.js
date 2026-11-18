/** Stores one draft and its original images on this device. Updates are atomic. */
const ScanDraft = (() => {
  let open;
  function database() {
    open ||= new Promise((resolve, reject) => {
      const request = indexedDB.open("pdf-pro-scan-draft", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("draft");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => { open = null; throw error; });
    return open;
  }

  async function read(key) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction("draft").objectStore("draft").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function save(pages, original, discarded = []) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("draft", "readwrite");
      const store = transaction.objectStore("draft");
      if (original) store.put(original.file, original.key);
      for (const key of discarded) {
        if (!pages.some((page) => page.sourceId === key)) store.delete(key);
      }
      store.put(pages, "pages");
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
  }

  return { read, save };
})();
