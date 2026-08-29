const IMAGE_CACHE = "anime-quiz-images-v1";
const IMAGE_LIMIT = 2000;
const DB_NAME = "anime-quiz-image-lru";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("entries");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function touch(url) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("entries", "readwrite");
      tx.objectStore("entries").put(Date.now(), url);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

async function trimCache() {
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const keys = await cache.keys();
    if (keys.length <= IMAGE_LIMIT) return;
    const db = await openDb();
    const entries = await new Promise((resolve, reject) => {
      const tx = db.transaction("entries", "readonly");
      const request = tx.objectStore("entries").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const urls = await new Promise((resolve, reject) => {
      const tx = db.transaction("entries", "readonly");
      const request = tx.objectStore("entries").getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const ordered = urls.map((url, index) => ({ url, time: entries[index] || 0 })).sort((a, b) => a.time - b.time);
    for (const entry of ordered.slice(0, Math.max(0, keys.length - IMAGE_LIMIT))) {
      await cache.delete(entry.url);
      const tx = db.transaction("entries", "readwrite");
      tx.objectStore("entries").delete(entry.url);
    }
    db.close();
  } catch {}
}

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.destination !== "image") return;
  event.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(event.request);
    if (cached) {
      event.waitUntil(touch(event.request.url));
      return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === "opaque") {
        await cache.put(event.request, response.clone());
        await touch(event.request.url);
        await trimCache();
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});
