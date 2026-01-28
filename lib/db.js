/**
 * IndexedDB storage for email embeddings.
 */

const DB_NAME = "seriate";
const DB_VERSION = 1;
const STORE_NAME = "embeddings";

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "messageId" });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * @param {string} messageId - Message-ID header value
 * @returns {Promise<number[] | null>} Embedding vector or null
 */
async function getEmbedding(messageId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(messageId);
    request.onsuccess = () => resolve(request.result?.embedding ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {string[]} messageIds
 * @returns {Promise<Map<string, number[]>>} Map of messageId -> embedding
 */
async function getEmbeddings(messageIds) {
  const db = await openDB();
  const needed = new Set(messageIds);
  const results = new Map();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (needed.has(cursor.value.messageId)) {
          results.set(cursor.value.messageId, cursor.value.embedding);
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {Array<{messageId: string, embedding: number[]}>} entries
 * @returns {Promise<void>}
 */
async function storeEmbeddings(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const entry of entries) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
