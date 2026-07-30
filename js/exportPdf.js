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

    const pdfDoc = await PDFDocument.load(originalBytes.slice(0));
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

  async function saveToDevice() {
    Loader.show("Generando PDF firmado…");
    try {
      const blob = await buildSignedPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      Toast.show("PDF guardado correctamente");
    } finally {
      Loader.hide();
    }
  }

  async function shareFile() {
    Loader.show("Preparando para compartir…");
    try {
      const blob = await buildSignedPdf();
      const file = new File([blob], suggestedFileName(), { type: "application/pdf" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "PDF firmado",
          text: "Documento firmado con PDF Signer Pro",
        });
      } else {
        // Fallback: descarga directa si Web Share API no está disponible
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedFileName();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        Toast.show("Tu navegador no soporta compartir directamente: PDF descargado");
      }
    } catch (err) {
      if (err && err.name !== "AbortError") {
        Toast.show("No se pudo compartir el documento");
      }
    } finally {
      Loader.hide();
    }
  }

  return { buildSignedPdf, saveToDevice, shareFile, suggestedFileName };
})();
