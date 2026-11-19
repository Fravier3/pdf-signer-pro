/**
 * service-worker.js — Cachea toda la app para que funcione 100% offline
 * una vez instalada. Estrategia: "cache first, network fallback" para
 * el shell de la app, y "network first" para navegación de documento.
 */
const CACHE_NAME = "pdf-signer-pro-v20";

const EDIT_ENGINE_CACHE = "pdf-pro-edit-engine-1";
const EDIT_ENGINE_ASSETS = [
  "https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.1/dist/",
  "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/",
  "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2/",
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int/",
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/",
];

const ENGINE_CACHE = "pdf-pro-opencv-4.10.0-release.1";
const ENGINE_URL = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./css/scan.css",
  "./js/ui.js",
  "./js/db.js",
  "./js/theme.js",
  "./js/toast.js",
  "./js/bottomSheet.js",
  "./js/signatures.js",
  "./js/drawSignature.js",
  "./js/pdfViewer.js",
  "./js/pdfEditor.js",
  "./js/pdfEditText.js",
  "./js/pdfEditEngine.mjs",
  "./js/pdfEditWorker.mjs",
  "./js/pdfEditOcr.mjs",
  "./js/pdfOcrWorker.js",
  "./js/placement.js",
  "./js/exportPdf.js",
  "./js/app.js",
  "./js/scan.js",
  "./js/scanEngines.js",
  "./js/scanDraft.js",
  "./js/scanRasters.js",
  "./js/scanCamera.js",
  "./js/scanImage.js",
  "./js/lib/pdf.min.js",
  "./js/lib/pdf.worker.min.js",
  "./js/lib/pdf-lib.min.js",
  "./js/lib/motion.min.js",
  "./js/lib/lucide-icons.js",
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
          // cache:"reload" salta la caché HTTP del navegador: sin esto, una
          // actualización podía volver a guardar archivos de la versión anterior.
          cache.add(new Request(url, { cache: "reload" })).catch((err) => console.warn("No se pudo cachear:", url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("pdf-signer-pro-") && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = event.request.url;
  const editAsset = EDIT_ENGINE_ASSETS.some((prefix) => url.startsWith(prefix));
  if (editAsset || url === ENGINE_URL ||
      url.startsWith("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/") ||
      url === "https://cdn.jsdelivr.net/npm/quadscan@1.0.0/models/lcnet100_h_e_bifpn_256_fp32.onnx") {
    event.respondWith((async () => {
      const cache = await caches.open(editAsset ? EDIT_ENGINE_CACHE : ENGINE_CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if ((response.ok && response.type === "cors") || (editAsset && response.type === "opaque")) {
        try { await cache.put(event.request, response.clone()); } catch { /* storage unavailable */ }
      }
      return response;
    })());
    return;
  }
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then(async (response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            try { await (await caches.open(CACHE_NAME)).put(event.request, clone); } catch { /* storage unavailable */ }
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
