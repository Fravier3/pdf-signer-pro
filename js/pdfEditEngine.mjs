const PDFIUM_URL = "https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.1/dist/";
const [PDF_TEXT, PDF_PATH, PDF_IMAGE, PDF_SHADING, PDF_FORM] = [1, 2, 3, 4, 5];
const INVISIBLE = 3;
let engine;

async function getEngine() {
  if (!engine) {
    engine = (async () => {
      const { init } = await import(PDFIUM_URL + "index.browser.js");
      const response = await fetch(PDFIUM_URL + "pdfium.wasm");
      if (!response.ok) throw new Error("No se pudo descargar el motor de edición.");
      const api = await init({ wasmBinary: await response.arrayBuffer() });
      api.PDFiumExt_Init();
      return api;
    })().catch((err) => { engine = null; throw err; });
  }
  return engine;
}

function requireResult(result, message) {
  if (!result) throw new Error(message);
  return result;
}

function memory(api, size, use) {
  const { wasmExports } = api.pdfium;
  const pointer = requireResult(wasmExports.malloc(size), "Memoria insuficiente para editar el PDF.");
  try {
    return use(pointer);
  } finally {
    wasmExports.free(pointer);
  }
}

function utf16(api, text, use) {
  return memory(api, (text.length + 1) * 2, (pointer) => {
    api.pdfium.stringToUTF16(text, pointer, (text.length + 1) * 2);
    return use(pointer);
  });
}

function getBounds(api, object) {
  return memory(api, 16, (p) => {
    if (!api.FPDFPageObj_GetBounds(object, p, p + 4, p + 8, p + 12)) return null;
    return Array.from(api.pdfium.HEAPF32.subarray(p / 4, p / 4 + 4));
  });
}

function getMatrix(api, object) {
  return memory(api, 24, (p) => {
    requireResult(api.FPDFPageObj_GetMatrix(object, p), "No se pudo leer la orientación del objeto.");
    return Array.from(api.pdfium.HEAPF32.subarray(p / 4, p / 4 + 6));
  });
}

function setMatrix(api, object, matrix, operation) {
  memory(api, 24, (p) => {
    api.pdfium.HEAPF32.set(matrix, p / 4);
    requireResult(operation(object, p), "No se pudo transformar el objeto.");
  });
}

function textOf(api, object, textPage) {
  const length = api.FPDFTextObj_GetText(object, textPage, 0, 0);
  return length > 2 ? memory(api, length, (p) => {
    api.FPDFTextObj_GetText(object, textPage, p, length);
    return api.pdfium.UTF16ToString(p);
  }) : "";
}

function withTextPage(api, page, use) {
  const textPage = requireResult(api.FPDFText_LoadPage(page), "No se pudo leer el texto de la página.");
  try {
    return use(textPage);
  } finally {
    api.FPDFText_ClosePage(textPage);
  }
}

function readObjects(api, page) {
  return withTextPage(api, page, (textPage) => {
    const objects = [];
    const count = api.FPDFPage_CountObjects(page);
    for (let id = 0; id < count; id++) {
      const object = api.FPDFPage_GetObject(page, id);
      const type = api.FPDFPageObj_GetType(object);
      if (![PDF_TEXT, PDF_PATH, PDF_IMAGE, PDF_SHADING, PDF_FORM].includes(type)) continue;
      const bounds = getBounds(api, object);
      if (!bounds?.every(Number.isFinite)) continue;
      if (type === PDF_TEXT) {
        const text = textOf(api, object, textPage);
        const hidden = api.FPDFTextObj_GetTextRenderMode(object) === INVISIBLE;
        if (text.trim()) objects.push({ id, type, bounds, text, hidden });
      } else {
        objects.push({ id, type, bounds });
      }
    }
    return objects;
  });
}

function fontName(api, font) {
  const length = api.FPDFFont_GetBaseFontName(font, 0, 0);
  return length > 1 ? memory(api, length, (p) => {
    api.FPDFFont_GetBaseFontName(font, p, length);
    return api.pdfium.UTF8ToString(p);
  }) : "";
}

function similarFont(name) {
  const bold = /bold|black|heavy/i.test(name);
  const italic = /italic|oblique/i.test(name);
  if (/times|serif|garamond|cambria|georgia/i.test(name) && !/sans/i.test(name)) {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    return italic ? "Times-Italic" : "Times-Roman";
  }
  const family = /courier|mono|consolas/i.test(name) ? "Courier" : "Helvetica";
  if (bold && italic) return family + "-BoldOblique";
  if (bold) return family + "-Bold";
  return italic ? family + "-Oblique" : family;
}

function copyColor(api, source, target, read, write) {
  memory(api, 16, (p) => {
    if (read(source, p, p + 4, p + 8, p + 12)) {
      write(target, ...api.pdfium.HEAPU32.subarray(p / 4, p / 4 + 4));
    }
  });
}

function remove(api, page, object) {
  requireResult(api.FPDFPage_RemoveObject(page, object), "No se pudo retirar el contenido anterior.");
  api.FPDFPageObj_Destroy(object);
}

function writeText(api, doc, page, id, object, text) {
  if (!text.trim()) {
    remove(api, page, object);
    return;
  }

  const font = api.FPDFTextObj_GetFont(object);
  const base = fontName(api, font);
  const fallback = similarFont(base);
  const hasBasicLatinFont = /^[\x20-\x7e\xa0-\xff€“”‘’–—…]+$/.test(text);

  const marked = api.FPDFPageObj_CountMarks(object) > 0;
  if (!marked && (base === fallback || !hasBasicLatinFont)) {
    const accepted = utf16(api, text, (p) => api.FPDFText_SetText(object, p));
    const resultingText = accepted ? withTextPage(api, page, (textPage) => textOf(api, object, textPage)) : "";
    if (resultingText === text) return;
    if (!hasBasicLatinFont) throw new Error("La fuente original no admite todos los caracteres de la corrección.");
  }

  if (!hasBasicLatinFont) throw new Error("La fuente de reemplazo no admite todos los caracteres de la corrección.");

  const size = memory(api, 4, (p) => {
    requireResult(api.FPDFTextObj_GetFontSize(object, p), "No se pudo leer el tamaño del texto.");
    return api.pdfium.HEAPF32[p / 4];
  });
  const replacement = requireResult(api.FPDFPageObj_NewTextObj(doc, fallback, size), "No se pudo crear el texto.");
  let inserted = false;
  try {
    requireResult(utf16(api, text, (p) => api.FPDFText_SetText(replacement, p)), "La corrección contiene caracteres que la fuente no admite.");
    setMatrix(api, replacement, getMatrix(api, object), api.FPDFPageObj_SetMatrix);
    copyColor(api, object, replacement, api.FPDFPageObj_GetFillColor, api.FPDFPageObj_SetFillColor);
    copyColor(api, object, replacement, api.FPDFPageObj_GetStrokeColor, api.FPDFPageObj_SetStrokeColor);
    api.FPDFTextObj_SetTextRenderMode(replacement, api.FPDFTextObj_GetTextRenderMode(object));
    inserted = api.FPDFPage_InsertObjectAtIndex(page, replacement, id);
    requireResult(inserted, "No se pudo insertar el texto en la página.");
    remove(api, page, object);
  } finally {
    if (!inserted) api.FPDFPageObj_Destroy(replacement);
  }
}

function sampleBackground(api, bitmap, left, top, right, bottom) {
  const width = api.FPDFBitmap_GetWidth(bitmap);
  const height = api.FPDFBitmap_GetHeight(bitmap);
  const stride = api.FPDFBitmap_GetStride(bitmap);
  const pointer = api.FPDFBitmap_GetBuffer(bitmap);
  const pixelBytes = [0, 1, 3, 4, 4][api.FPDFBitmap_GetFormat(bitmap)];
  if (!pixelBytes) throw new Error("El formato de esta imagen escaneada no admite correcciones.");
  const pixels = api.pdfium.HEAPU8;
  const channels = [[], [], []];
  function sample(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = pointer + y * stride + x * pixelBytes;
    for (let i = 0; i < 3; i++) channels[i].push(pixels[p + (pixelBytes === 1 ? 0 : i)]);
  }

  for (let i = 0; i < 32; i++) {
    const x = left + Math.floor(i * (right - left - 1) / 31);
    const y = top + Math.floor(i * (bottom - top - 1) / 31);
    sample(x, top - 2);
    sample(x, bottom + 1);
    sample(left - 2, y);
    sample(right + 1, y);
  }
  const [b, g, r] = channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 255);
  return (255 * 2 ** 24 + r * 2 ** 16 + g * 2 ** 8 + b) >>> 0;
}

function patchScan(api, page, image, corners) {
  const [a, b, c, d, e, f] = getMatrix(api, image);
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 0.001) throw new Error("La imagen escaneada tiene una orientación no compatible.");
  const xs = corners.map(([x, y]) => (d * (x - e) - c * (y - f)) / determinant);
  const ys = corners.map(([x, y]) => 1 - (a * (y - f) - b * (x - e)) / determinant);
  const bitmap = requireResult(api.FPDFImageObj_GetBitmap(image), "No se pudo leer la imagen escaneada.");
  try {
    const width = api.FPDFBitmap_GetWidth(bitmap);
    const height = api.FPDFBitmap_GetHeight(bitmap);
    const left = Math.max(0, Math.floor(Math.min(...xs) * width) - 1);
    const top = Math.max(0, Math.floor(Math.min(...ys) * height) - 1);
    const right = Math.min(width, Math.ceil(Math.max(...xs) * width) + 1);
    const bottom = Math.min(height, Math.ceil(Math.max(...ys) * height) + 1);
    requireResult(right > left && bottom > top, "El texto seleccionado queda fuera de la imagen.");
    const background = sampleBackground(api, bitmap, left, top, right, bottom);
    requireResult(api.FPDFBitmap_FillRect(bitmap, left, top, right - left, bottom - top, background), "No se pudo reemplazar el texto en la imagen.");
    memory(api, 4, (p) => {
      api.pdfium.HEAPU32[p / 4] = page;
      requireResult(api.FPDFImageObj_SetBitmap(p, 1, image, bitmap), "No se pudo guardar la imagen corregida.");
    });
  } finally {
    api.FPDFBitmap_Destroy(bitmap);
  }
}

function writeOcr(api, doc, page, image, action) {
  const { corners, text, baseline, size, direction, width } = action;
  const left = Math.min(...corners.map(([x]) => x));
  const right = Math.max(...corners.map(([x]) => x));
  const bottom = Math.min(...corners.map(([, y]) => y));
  const top = Math.max(...corners.map(([, y]) => y));
  const intersect = (bounds) => bounds && Math.min(bounds[2], right) - Math.max(bounds[0], left) > 0.5
    && Math.min(bounds[3], top) - Math.max(bounds[1], bottom) > 0.5;
  const removeText = [];
  for (let i = 0; i < api.FPDFPage_CountObjects(page); i++) {
    const object = api.FPDFPage_GetObject(page, i);
    const type = api.FPDFPageObj_GetType(object);
    if (type === PDF_FORM && intersect(getBounds(api, object))) {
      throw new Error("El área seleccionada contiene un grupo PDF que requiere edición por separado.");
    }
    if (type === PDF_TEXT && intersect(getBounds(api, object))) {
      const [x0, y0, x1, y1] = getBounds(api, object);
      if (x0 < left - 2 || y0 < bottom - 2 || x1 > right + 2 || y1 > top + 2) {
        throw new Error("La capa de texto abarca más de una palabra. Selecciona la línea completa.");
      }
      removeText.push(object);
    }
  }

  patchScan(api, page, image, corners);
  removeText.forEach((object) => remove(api, page, object));
  if (!text.trim()) return;

  if (!/^[\x20-\x7e\xa0-\xff€“”‘’–—…]+$/.test(text)) {
    throw new Error("La fuente de OCR admite caracteres latinos, como los del español y del inglés.");
  }
  const replacement = requireResult(api.FPDFPageObj_NewTextObj(doc, "Helvetica", size), "No se pudo crear la corrección.");
  let inserted = false;
  try {
    requireResult(utf16(api, text, (p) => api.FPDFText_SetText(replacement, p)), "No se pudo escribir la corrección.");
    const [dx, dy] = direction;
    const [x0, , x1] = getBounds(api, replacement);
    const stretch = Math.min(1, width / Math.max(1, x1 - x0));
    setMatrix(api, replacement, [dx * stretch, dy * stretch, -dy, dx, ...baseline], api.FPDFPageObj_SetMatrix);
    api.FPDFPage_InsertObject(page, replacement);
    inserted = true;
  } finally {
    if (!inserted) api.FPDFPageObj_Destroy(replacement);
  }
}

function save(api, doc) {
  const writer = requireResult(api.PDFiumExt_OpenFileWriter(), "No se pudo preparar la copia del PDF.");
  try {
    requireResult(api.FPDF_SaveAsCopy(doc, writer, 2), "No se pudo guardar la copia corregida.");
    const size = api.PDFiumExt_GetFileWriterSize(writer);
    return memory(api, size, (p) => {
      requireResult(api.PDFiumExt_GetFileWriterData(writer, p, size), "No se pudo leer la copia corregida.");
      return api.pdfium.HEAPU8.slice(p, p + size).buffer;
    });
  } finally {
    api.PDFiumExt_CloseFileWriter(writer);
  }
}

export async function handlePdfEdit({ bytes, pageNum, action }) {
  const api = await getEngine();
  return memory(api, bytes.byteLength, (p) => {
    api.pdfium.HEAPU8.set(new Uint8Array(bytes), p);
    const doc = requireResult(api.FPDF_LoadMemDocument64(p, bytes.byteLength, ""), "No se puede editar este PDF. Puede estar protegido o dañado.");
    try {
      if (api.EPDF_IsEncrypted(doc)) throw new Error("La edición requiere una copia del PDF sin protección.");
      const page = requireResult(api.FPDF_LoadPage(doc, pageNum - 1), "No se pudo abrir la página para editar.");
      try {
        if (!action) return readObjects(api, page);
        const object = requireResult(api.FPDFPage_GetObject(page, action.id), "El objeto ya no está en la página.");
        const type = api.FPDFPageObj_GetType(object);
        if (action.kind === "text" && type === PDF_TEXT) {
          writeText(api, doc, page, action.id, object, action.text);
        } else if (action.kind === "ocr" && type === PDF_IMAGE) {
          writeOcr(api, doc, page, object, action);
        } else if (action.kind === "transform" && [PDF_PATH, PDF_IMAGE, PDF_FORM, PDF_SHADING].includes(type)) {
          setMatrix(api, object, action.matrix, api.FPDFPageObj_TransformF);
        } else {
          throw new Error("El objeto no es compatible con la herramienta seleccionada.");
        }
        requireResult(api.FPDFPage_GenerateContent(page), "No se pudo actualizar el contenido de la página.");
        return save(api, doc);
      } finally {
        api.FPDF_ClosePage(page);
      }
    } finally {
      api.FPDF_CloseDocument(doc);
    }
  });
}
