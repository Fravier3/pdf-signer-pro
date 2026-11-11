/**
 * pdfViewer.js — Renderiza el PDF con PDF.js, con soporte de:
 *  - scroll vertical entre páginas
 *  - indicador de página actual
 *  - pinch-to-zoom, doble toque, Ctrl+rueda y botones de zoom
 *  - arrastre (pan) libre en cualquier dirección, también con el ratón
 *  - lazy rendering para documentos grandes
 */
const PdfViewer = (() => {
  let pdfDoc = null;
  let scale = 1;
  let baseScale = 1;
  let minScale = 0.5;
  let maxScale = 4;
  let container, pagesWrap, sizer;
  let listenersBound = false;
  let onZoomChange = null;
  let pageWrappers = []; // { pageNum, wrapEl, canvas, rendered, rendering }
  let currentBytes = null;
  let lazyObserver = null;
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
    Loader.show("Abriendo documento…");
    try {
      const bytes = await file.arrayBuffer();
      const nextDoc = await loadDocument(bytes);
      replaceDocument(nextDoc);
      currentBytes = bytes;
      currentFileName = file.name || "Documento.pdf";
      document.getElementById("viewer-filename").textContent = currentFileName;
    } finally {
      Loader.hide();
    }

    container = document.getElementById("pdf-scroll");
    pagesWrap = document.getElementById("pdf-pages");
    sizer = document.getElementById("pdf-sizer");
    pagesWrap.innerHTML = "";
    pagesWrap.style.transform = "";
    pageWrappers = [];
    scale = 1;
    container.scrollTop = 0;
    container.scrollLeft = 0;
    layoutZoom();
    notifyZoom();

    updatePageIndicator(1, pdfDoc.numPages);

    setupLazyRendering();
    addPageWrappers(1);
    // Los listeners del contenedor se registran una sola vez (antes se
    // acumulaban con cada documento abierto).
    if (!listenersBound) {
      listenersBound = true;
      setupScrollPageIndicator();
      setupGestures();
      setupZoomLayout();
    }

    // Render primeras páginas inmediatamente
    await renderPage(1);
    if (pdfDoc.numPages > 1) renderPage(2);
  }

  async function loadDocument(bytes) {
    const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    try {
      return await task.promise;
    } catch (err) {
      await task.destroy().catch(console.warn);
      throw err;
    }
  }

  function replaceDocument(nextDoc) {
    const previousDoc = pdfDoc;
    pdfDoc = nextDoc;
    if (previousDoc) {
      Promise.allSettled(pageWrappers.map(({ rendering }) => rendering))
        .then(() => previousDoc.destroy()).catch(console.warn);
    }
  }

  async function appendFile(file) {
    const originalDoc = pdfDoc;
    if (!originalDoc) return 0;
    const { PDFDocument } = PDFLib;
    const merged = await PDFDocument.load(currentBytes);
    const additional = await PDFDocument.load(await file.arrayBuffer());
    const pages = await merged.copyPages(additional, additional.getPageIndices());
    if (!pages.length) throw new Error("El PDF no contiene páginas.");
    pages.forEach((page) => merged.addPage(page));
    const bytes = (await merged.save()).buffer;
    const nextDoc = await loadDocument(bytes);
    if (pdfDoc !== originalDoc) {
      await nextDoc.destroy();
      return 0;
    }

    replaceDocument(nextDoc);
    currentBytes = bytes;
    for (const { pageNum, wrapEl } of pageWrappers) {
      wrapEl.querySelector(".pdf-page-number-badge").textContent = `${pageNum} / ${pdfDoc.numPages}`;
    }
    addPageWrappers(originalDoc.numPages + 1);
    layoutZoom();
    updateVisiblePage();
    return pages.length;
  }

  function addPageWrappers(firstPage) {
    for (let pageNum = firstPage; pageNum <= pdfDoc.numPages; pageNum++) {
      const wrapEl = document.createElement("div");
      wrapEl.className = "pdf-page-wrap";
      wrapEl.dataset.pageNum = pageNum;
      const canvas = document.createElement("canvas");
      const badge = document.createElement("div");
      badge.className = "pdf-page-number-badge";
      badge.textContent = `${pageNum} / ${pdfDoc.numPages}`;
      wrapEl.append(canvas, badge);
      pagesWrap.appendChild(wrapEl);
      pageWrappers.push({ pageNum, wrapEl, canvas, rendered: false, rendering: null });
      lazyObserver.observe(wrapEl);
    }
  }

  function renderPage(pageNum) {
    const entry = pageWrappers[pageNum - 1];
    if (!entry || entry.rendered) return;
    if (!entry.rendering) {
      entry.rendering = paintPage(pdfDoc, entry)
        .catch((err) => console.warn("No se pudo mostrar la página", pageNum, err))
        .finally(() => { entry.rendering = null; });
    }
    return entry.rendering;
  }

  async function paintPage(doc, entry) {
    const { pageNum } = entry;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = entry.canvas;
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    entry.wrapEl.style.width = viewport.width + "px";
    entry.wrapEl.style.maxWidth = "94%";
    // aspect-ratio (en vez de una altura fija en px) es lo que evita que
    // la página se vea "estirada" cuando max-width la encoge en pantallas
    // angostas: el alto ahora escala siempre en proporción al ancho real.
    entry.wrapEl.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    entry.wrapEl.style.height = "auto";

    await page.render({ canvasContext: ctx, viewport }).promise;
    entry.rendered = true;
    entry.wrapEl.dispatchEvent(new CustomEvent("page-rendered", { detail: { pageNum } }));
  }

  function setupLazyRendering() {
    lazyObserver?.disconnect();
    lazyObserver = new IntersectionObserver(
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
  }

  function setupScrollPageIndicator() {
    let ticking = false;
    container.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateVisiblePage();
      });
    });
  }

  function updateVisiblePage() {
    if (!pdfDoc) return;
    const mid = container.scrollTop + container.clientHeight / 2;
    let current = 1;
    for (const p of pageWrappers) {
      if (p.wrapEl.offsetTop * scale <= mid) current = p.pageNum;
    }
    updatePageIndicator(current, pdfDoc.numPages);
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
    // Escritorio: Ctrl/⌘ + rueda (o pellizco en trackpad) amplía hacia el cursor
    container.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setScale(scale * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      },
      { passive: false }
    );
    setupMousePan();
  }

  // Arrastrar con el ratón para mover el documento en cualquier dirección
  function setupMousePan() {
    container.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest(".placed-sig")) return;
      // Clic sobre la barra de scroll: no es un arrastre del documento.
      const r = container.getBoundingClientRect();
      if (e.clientX > r.left + container.clientWidth || e.clientY > r.top + container.clientHeight) return;
      panState = { x: e.clientX, y: e.clientY, left: container.scrollLeft, top: container.scrollTop };
      container.classList.add("panning");
    });
    window.addEventListener("mousemove", (e) => {
      if (!panState) return;
      container.scrollLeft = panState.left - (e.clientX - panState.x);
      container.scrollTop = panState.top - (e.clientY - panState.y);
    });
    window.addEventListener("mouseup", () => {
      if (!panState) return;
      panState = null;
      container.classList.remove("panning");
    });
  }

  // ---------------- ZOOM: maquetación ----------------
  function centerOffset(cw) {
    // Con zoom < 100 % el documento se centra; con zoom mayor arranca en 0
    // para que el scroll alcance también el borde izquierdo.
    return Math.max(0, (cw - cw * scale) / 2);
  }

  /**
   * .pdf-pages se escala con transform (no ocupa más espacio en el layout),
   * así que .pdf-sizer reserva el área real escalada: de ese modo el
   * documento ampliado se puede recorrer entero en ambas direcciones.
   */
  function layoutZoom() {
    if (!container || !pagesWrap || !sizer) return;
    const cw = container.clientWidth;
    if (!cw) return;
    pagesWrap.style.width = cw + "px";
    sizer.style.width = Math.max(cw, cw * scale) + "px";
    sizer.style.height = pagesWrap.offsetHeight * scale + "px";
    pagesWrap.style.transform = `translate(${centerOffset(cw)}px, 0) scale(${scale})`;
  }

  function setupZoomLayout() {
    if (!("ResizeObserver" in window)) {
      window.addEventListener("resize", layoutZoom);
      return;
    }
    const ro = new ResizeObserver(() => layoutZoom());
    ro.observe(container);
    ro.observe(pagesWrap);
  }

  /**
   * Cambia el zoom manteniendo fijo el punto del documento que está bajo
   * (clientX, clientY); por defecto, el centro del visor.
   */
  function setScale(next, clientX, clientY) {
    if (!container || !pdfDoc) return;
    const rect = container.getBoundingClientRect();
    const fx = (clientX == null ? rect.left + container.clientWidth / 2 : clientX) - rect.left;
    const fy = (clientY == null ? rect.top + container.clientHeight / 2 : clientY) - rect.top;
    const cw = container.clientWidth;
    const docX = (container.scrollLeft + fx - centerOffset(cw)) / scale;
    const docY = (container.scrollTop + fy) / scale;
    scale = clamp(next, minScale, maxScale);
    layoutZoom();
    container.scrollLeft = docX * scale + centerOffset(cw) - fx;
    container.scrollTop = docY * scale - fy;
    notifyZoom();
  }

  function notifyZoom() {
    if (onZoomChange) onZoomChange(scale);
  }

  function zoomIn() {
    setScale(scale * 1.25);
  }
  function zoomOut() {
    setScale(scale / 1.25);
  }
  function resetZoom() {
    setScale(1);
  }
  function setOnZoomChange(fn) {
    onZoomChange = fn;
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
        setScale(target, e.touches[0].clientX, e.touches[0].clientY);
      }
      lastTapTime = now;
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2 && !PlacementManager.isEditingActive()) {
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      const factor = d / (pinchStartDist || d);
      setScale(
        pinchStartScale * factor,
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2
      );
    }
  }

  function onTouchEnd() {
    pinchStartDist = 0;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
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
    return currentBytes;
  }

  function reset() {
    replaceDocument(null);
    currentBytes = null;
    lazyObserver?.disconnect();
    pageWrappers = [];
    if (pagesWrap) pagesWrap.innerHTML = "";
    scale = 1;
    layoutZoom();
    notifyZoom();
  }

  return {
    openFile,
    appendFile,
    getPdfDoc,
    getPageWrapEl,
    getAllPageWraps,
    getFileName,
    getOriginalBytes,
    reset,
    zoomIn,
    zoomOut,
    resetZoom,
    setOnZoomChange,
    hasDocument: () => !!pdfDoc,
  };
})();
