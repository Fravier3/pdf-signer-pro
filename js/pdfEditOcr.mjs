const CDN = "https://cdn.jsdelivr.net/npm/";
let tesseract;

function loadLibrary() {
  if (!tesseract) {
    tesseract = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CDN + "tesseract.js@6.0.1/dist/tesseract.min.js";
      script.crossOrigin = "anonymous";
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => {
        script.remove();
        reject(new Error("No se pudo descargar OCR. Intenta con conexión a internet."));
      };
      document.head.append(script);
    }).catch((err) => { tesseract = null; throw err; });
  }
  return tesseract;
}

function regions(blocks) {
  const lines = [];
  const words = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        if (line.text.trim()) lines.push({ text: line.text.trim(), box: line.bbox, baseline: line.baseline });
        for (const word of line.words) {
          if (word.text.trim()) words.push({ text: word.text, box: word.bbox, baseline: line.baseline });
        }
      }
    }
  }
  return { word: words, line: lines };
}

export async function recognizePage(page, onProgress) {
  const library = await loadLibrary();
  const normal = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 3000 / Math.max(normal.width, normal.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  let worker;
  let timer;
  try {
    await page.render({ canvasContext: canvas.getContext("2d"), viewport, annotationMode: pdfjsLib.AnnotationMode?.DISABLE }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    if (!blob) throw new Error("No se pudo preparar la imagen para OCR.");
    canvas.width = canvas.height = 0;
    const { data } = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("OCR tardó demasiado. Intenta de nuevo.")), 90000);
      const recognize = async () => {
        const active = await library.createWorker("spa+eng", 1, {
          workerPath: new URL("./pdfOcrWorker.js", import.meta.url).href,
          workerBlobURL: false,
          corePath: CDN + "tesseract.js-core@6.1.2",
          cachePath: "pdf-pro-edit-ocr-1",
          logger: (message) => onProgress(message.status === "recognizing text" ? message.progress : null),
          errorHandler: (error) => reject(new Error(String(error))),
        });
        if (!timer) {
          await active.terminate();
          return;
        }
        worker = active;
        return active.recognize(blob, {}, { blocks: true });
      };
      recognize().then(resolve, reject);
    });
    return { viewport, regions: regions(data.blocks) };
  } finally {
    clearTimeout(timer);
    timer = null;
    canvas.width = canvas.height = 0;
    await worker?.terminate();
  }
}
