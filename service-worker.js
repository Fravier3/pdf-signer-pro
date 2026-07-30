/**
 * service-worker.js — Cachea toda la app para que funcione 100% offline
 * una vez instalada. Estrategia: "cache first, network fallback" para
 * el shell de la app, y "network first" para navegación de documento.
 */
const CACHE_NAME = "pdf-signer-pro-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/db.js",
  "./js/theme.js",
  "./js/toast.js",
  "./js/bottomSheet.js",
  "./js/signatures.js",
  "./js/drawSignature.js",
  "./js/pdfViewer.js",
  "./js/placement.js",
  "./js/exportPdf.js",
  "./js/app.js",
  "./js/lib/pdf.min.js",
  "./js/lib/pdf.worker.min.js",
  "./js/lib/pdf-lib.min.js",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll falla si algún recurso no existe; los añadimos uno a uno
      // para que la instalación no se rompa si falta un archivo opcional.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn("No se pudo cachear:", url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
    })
  );
});
