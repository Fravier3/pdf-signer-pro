/**
 * pdfViewer.js — Renderiza el PDF con PDF.js, con soporte de:
 *  - scroll vertical entre páginas
 *  - indicador de página actual
 *  - pinch-to-zoom, doble toque para zoom, arrastre (pan)
 *  - lazy rendering para documentos grandes
 */
const PdfViewer = (() => {
  let pdfDoc = null;
  let scale = 1;
  let baseScale = 1;
  let minScale = 0.5;
  let maxScale = 4;
  let container, pagesWrap;
  let pageWrappers = []; // { pageNum, wrapEl, canvas, rendered, rendering }
  let currentFile = null;
  let currentFileName = "";
  let onPageChange = null;

  // ---- Gesture state ----
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let lastTapTime = 0;
  let panState = null;

  function setWorker() {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "js/lib/pdf.worker.min.js";
    }
  }

  async function openFile(file) {
    setWorker();
    currentFile = file;
    currentFileName = file.name || "Documento.pdf";
    document.getElementById("viewer-filename").textContent = currentFileName;

    const arrayBuffer = await file.arrayBuffer();
    // Guardamos una copia intacta para exportación (nunca se modifica el original)
    currentFile._bytes = arrayBuffer.slice(0);

    Loader.show("Abriendo documento…");
    try {
      pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
    } finally {
      Loader.hide();
    }

    container = document.getElementById("pdf-scroll");
    pagesWrap = document.getElementById("pdf-pages");
    pagesWrap.innerHTML = "";
    pagesWrap.style.transform = "";
    pageWrappers = [];
    scale = 1;

    updatePageIndicator(1, pdfDoc.numPages);

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const wrap = document.createElement("div");
      wrap.className = "pdf-page-wrap";
      wrap.dataset.pageNum = i;
      const canvas = document.createElement("canvas");
      wrap.appendChild(canvas);
      const badge = document.createElement("div");
      badge.className = "pdf-page-number-badge";
      badge.textContent = `${i} / ${pdfDoc.numPages}`;
      wrap.appendChild(badge);
      pagesWrap.appendChild(wrap);
      pageWrappers.push({ pageNum: i, wrapEl: wrap, canvas, rendered: false, rendering: false });
    }

    setupLazyRendering();
    setupScrollPageIndicator();
    setupGestures();

    // Render primeras páginas inmediatamente
    await renderPage(1);
    if (pdfDoc.numPages > 1) renderPage(2);
  }

  async function renderPage(pageNum) {
    const entry = pageWrappers[pageNum - 1];
    if (!entry || entry.rendered || entry.rendering) return;
    entry.rendering = true;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = entry.canvas;
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    entry.wrapEl.style.width = viewport.width + "px";
    entry.wrapEl.style.maxWidth = "94vw";
    // aspect-ratio (en vez de una altura fija en px) es lo que evita que
    // la página se vea "estirada" cuando max-width la encoge en pantallas
    // angostas: el alto ahora escala siempre en proporción al ancho real.
    entry.wrapEl.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    entry.wrapEl.style.height = "auto";

    await page.render({ canvasContext: ctx, viewport }).promise;
    entry.rendered = true;
    entry.rendering = false;
    entry.wrapEl.dispatchEvent(new CustomEvent("page-rendered", { detail: { pageNum } }));
  }

  function setupLazyRendering() {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const pn = parseInt(e.target.dataset.pageNum, 10);
            renderPage(pn);
            renderPage(pn + 1);
            renderPage(pn - 1);
          }
        });
      },
      { root: container, rootMargin: "600px 0px", threshold: 0.01 }
    );
    pageWrappers.forEach((p) => io.observe(p.wrapEl));
  }

  function setupScrollPageIndicator() {
    let ticking = false;
    container.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const mid = container.scrollTop + container.clientHeight / 2;
        let current = 1;
        for (const p of pageWrappers) {
          if (p.wrapEl.offsetTop <= mid) current = p.pageNum;
        }
        updatePageIndicator(current, pdfDoc.numPages);
        ticking = false;
      });
    });
  }

  function updatePageIndicator(current, total) {
    document.getElementById("viewer-page-indicator").textContent = `${current} / ${total}`;
    if (onPageChange) onPageChange(current, total);
  }

  // ---------------- GESTOS: pinch-zoom, doble toque, pan ----------------
  function setupGestures() {
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
  }

  function dist(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  function onTouchStart(e) {
    if (e.touches.length === 2 && !PlacementManager.isEditingActive()) {
      pinchStartDist = dist(e.touches[0], e.touches[1]);
      pinchStartScale = scale;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 280) {
        // doble toque -> alterna zoom
        e.preventDefault();
        const target = scale > 1.4 ? 1 : 2.2;
        animateScaleTo(target);
      }
      lastTapTime = now;
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2 && !PlacementManager.isEditingActive()) {
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      const factor = d / (pinchStartDist || d);
      scale = clamp(pinchStartScale * factor, minScale, maxScale);
      applyScale();
    }
  }

  function onTouchEnd() {
    pinchStartDist = 0;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function applyScale() {
    pagesWrap.style.transform = `scale(${scale})`;
  }

  function animateScaleTo(target) {
    scale = clamp(target, minScale, maxScale);
    pagesWrap.style.transition = "transform .25s ease";
    applyScale();
    setTimeout(() => (pagesWrap.style.transition = ""), 260);
  }

  function getPdfDoc() {
    return pdfDoc;
  }

  function getPageWrapEl(pageNum) {
    const entry = pageWrappers[pageNum - 1];
    return entry ? entry.wrapEl : null;
  }

  function getAllPageWraps() {
    return pageWrappers;
  }

  function getFileName() {
    return currentFileName;
  }

  function getOriginalBytes() {
    return currentFile ? currentFile._bytes : null;
  }

  function reset() {
    pdfDoc = null;
    currentFile = null;
    pageWrappers = [];
    if (pagesWrap) pagesWrap.innerHTML = "";
    scale = 1;
  }

  return {
    openFile,
    getPdfDoc,
    getPageWrapEl,
    getAllPageWraps,
    getFileName,
    getOriginalBytes,
    reset,
  };
})();
