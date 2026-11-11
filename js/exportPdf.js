/**
 * exportPdf.js — Genera un nuevo PDF con las firmas incrustadas de forma
 * permanente usando pdf-lib. El archivo original nunca se modifica.
 */
const PdfExporter = (() => {
  /**
   * @returns {Promise<Blob>} Blob del nuevo PDF con las firmas incrustadas.
   */
  async function buildSignedPdf() {
    const { PDFDocument, degrees } = PDFLib;
    const originalBytes = PdfViewer.getOriginalBytes();
    if (!originalBytes) throw new Error("No hay documento abierto.");

    if (!PlacementManager.hasAnyPlacement()) {
      return new Blob([originalBytes], { type: "application/pdf" });
    }
    const pdfDoc = await PDFDocument.load(originalBytes);
    const placements = PlacementManager.getPlacements();
    const pngCache = new Map();

    for (const pageNumStr of Object.keys(placements)) {
      const items = placements[pageNumStr];
      if (!items || items.length === 0) continue;
      const pageIndex = Number(pageNumStr) - 1;
      const page = pdfDoc.getPage(pageIndex);
      const { width: pageW, height: pageH } = page.getSize();

      for (const item of items) {
        let pngImage = pngCache.get(item.dataUrl);
        if (!pngImage) {
          const pngBytes = dataUrlToUint8Array(item.dataUrl);
          pngImage = await pdfDoc.embedPng(pngBytes);
          pngCache.set(item.dataUrl, pngImage);
        }

        const w = item.wRel * pageW;
        const h = item.hRel * pageH;
        // PDF usa origen inferior-izquierda; nuestras coords relativas usan
        // origen superior-izquierda (como en pantalla), por eso invertimos Y.
        const xTopLeft = item.xRel * pageW;
        const yTop = item.yRel * pageH;
        const yBottomLeft = pageH - yTop - h;

        // Centro deseado del bloque de la firma en coordenadas PDF
        const cx = xTopLeft + w / 2;
        const cy = yBottomLeft + h / 2;

        // pdf-lib rota la imagen (sentido antihorario) tomando x,y como la
        // esquina inferior-izquierda ANTES de rotar. Para que la rotación
        // quede centrada visualmente (igual que en pantalla), calculamos
        // la esquina inferior-izquierda necesaria para que, tras rotar,
        // el centro del bloque caiga exactamente en (cx, cy).
        const angleDeg = -(item.rotation || 0); // pantalla=horario, pdf-lib=antihorario
        const rad = (angleDeg * Math.PI) / 180;
        const dx = (w / 2) * Math.cos(rad) - (h / 2) * Math.sin(rad);
        const dy = (w / 2) * Math.sin(rad) + (h / 2) * Math.cos(rad);
        const x = cx - dx;
        const y = cy - dy;

        page.drawImage(pngImage, {
          x,
          y,
          width: w,
          height: h,
          rotate: degrees(angleDeg),
        });
      }
    }

    const bytes = await pdfDoc.save();
    return new Blob([bytes], { type: "application/pdf" });
  }

  function dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr;
  }

  function suggestedFileName() {
    const original = PdfViewer.getFileName() || "documento.pdf";
    const base = original.replace(/\.pdf$/i, "");
    return `${base}-firmado.pdf`;
  }

  const sheet = () => document.getElementById("pdf-export-sheet");
  const overlay = () => document.getElementById("pdf-export-overlay");
  let pendingExport = null;
  let returnFocus = null;
  let exporting = false;

  function download(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    Toast.show("Descarga iniciada");
  }

  function openExportSheet(file, saving) {
    pendingExport = { file, saving };
    returnFocus = document.activeElement;
    document.getElementById("pdf-export-title").textContent = saving ? "Guardar PDF" : "Compartir PDF";
    document.getElementById("pdf-export-native-label").textContent = saving ? "Elegir ubicación…" : "Abrir menú de compartir…";
    UI.showOverlay(overlay());
    UI.openSheet(sheet());
    document.getElementById("pdf-export-native").focus({ preventScroll: true });
  }

  function closeExportSheet() {
    pendingExport = null;
    UI.closeSheet(sheet());
    UI.hideOverlay(overlay());
    returnFocus?.focus({ preventScroll: true });
    returnFocus = null;
  }

  async function shareNative(file) {
    await navigator.share({ files: [file] });
  }

  async function prepareExport(saving) {
    if (exporting || pendingExport) return;
    exporting = true;
    const filename = suggestedFileName();
    let handle;
    try {
      if (saving && typeof window.showSaveFilePicker === "function") {
        try {
          handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
          });
        } catch (err) {
          if (err.name === "AbortError") return;
          if (err.name !== "SecurityError" && err.name !== "NotAllowedError") throw err;
        }
      }

      Loader.show("Preparando PDF…");
      let file;
      try {
        const blob = await buildSignedPdf();
        file = new File([blob], filename, { type: blob.type });
        if (handle) {
          const stream = await handle.createWritable();
          try {
            await stream.write(file);
            await stream.close();
          } catch (err) {
            await stream.abort().catch(() => {});
            throw err;
          }
          Toast.show("PDF guardado correctamente");
          return;
        }
      } finally {
        Loader.hide();
      }

      if (!navigator.canShare?.({ files: [file] })) {
        download(file);
        return;
      }
      try {
        await shareNative(file);
      } catch (err) {
        if (err.name === "AbortError") return;
        // Un PDF grande puede agotar el tiempo de activación del primer toque.
        // Conservamos el archivo ya generado para abrir el menú desde un toque nuevo.
        openExportSheet(file, saving);
      }
    } catch (err) {
      console.error(err);
      Toast.show(saving ? "No se pudo guardar el PDF" : "No se pudo compartir el PDF");
    } finally {
      exporting = false;
    }
  }

  function init() {
    document.getElementById("pdf-export-native").addEventListener("click", async () => {
      if (!pendingExport) return;
      const { file, saving } = pendingExport;
      closeExportSheet();
      try {
        await shareNative(file);
      } catch (err) {
        if (err.name === "AbortError") return;
        openExportSheet(file, saving);
        Toast.show("El menú del sistema no está disponible. Puedes descargar el PDF.");
      }
    });
    document.getElementById("pdf-export-download").addEventListener("click", () => {
      if (!pendingExport) return;
      const { file } = pendingExport;
      closeExportSheet();
      download(file);
    });
    document.getElementById("pdf-export-close").addEventListener("click", closeExportSheet);
    overlay().addEventListener("click", closeExportSheet);
    sheet().addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeExportSheet();
      else UI.trapFocus(sheet(), event);
    });
  }

  return {
    init,
    saveToDevice: () => prepareExport(true),
    shareFile: () => prepareExport(false),
  };
})();
