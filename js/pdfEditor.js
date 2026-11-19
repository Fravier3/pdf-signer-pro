const PdfEditor = (() => {
  const get = (id) => document.getElementById("pdf-edit-" + id);
  const scroll = document.getElementById("pdf-scroll");
  const panel = get("panel");
  const history = [];
  const maxHistoryBytes = 48 * 1024 * 1024;
  const requests = new Map();
  let worker;
  let requestId = 0;
  let enabled = false;
  let applying = false;
  let edited = false;
  let context;
  let revision = 0;
  let pageTimer;
  let mode = "text";
  let selected;
  let layer;
  let readingOcr = false;

  function setStatus(message) {
    get("status").textContent = message;
  }

  function stopWorker(error) {
    worker?.terminate();
    worker = null;
    for (const request of requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    requests.clear();
  }

  function execute(bytes, pageNum, action) {
    if (!worker) {
      worker = new Worker("js/pdfEditWorker.mjs", { type: "module" });
      worker.onerror = () => stopWorker(new Error("No se pudo iniciar el motor de edición."));
      worker.onmessage = ({ data }) => {
        const request = requests.get(data.id);
        if (!request) return;
        clearTimeout(request.timer);
        requests.delete(data.id);
        if (data.error) request.reject(new Error(data.error));
        else request.resolve(data.result);
      };
    }

    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const data = bytes.slice(0);
      const timer = setTimeout(() => stopWorker(new Error("La edición tardó demasiado. Intenta de nuevo con conexión a internet.")), 60000);
      requests.set(id, { resolve, reject, timer });
      worker.postMessage({ id, bytes: data, pageNum, action }, [data]);
    });
  }

  function discardSelection() {
    selected = null;
    get("form").hidden = true;
    get("transform").hidden = true;
    get("input").value = "";
  }

  function leave() {
    if (!enabled) return;
    enabled = false;
    revision++;
    clearTimeout(pageTimer);
    context = null;
    discardSelection();
    layer?.remove();
    layer = null;
    panel.hidden = true;
    get("toggle").setAttribute("aria-expanded", "false");
  }

  function reset() {
    leave();
    history.length = 0;
    edited = false;
    if (worker) stopWorker(new Error("Se cerró el documento."));
    updateControls();
  }

  function documentAppended() {
    history.length = 0;
    if (enabled) void inspect(PdfViewer.getVisiblePage());
    updateControls();
  }

  function updateControls() {
    get("undo").disabled = applying || !history.length;
    get("text").setAttribute("aria-pressed", String(mode === "text"));
    get("objects").setAttribute("aria-pressed", String(mode === "objects"));
    get("ocr").hidden = mode !== "text" || !context?.scan;
    get("ocr").disabled = applying || readingOcr;
    get("granularity").hidden = mode !== "text" || !(context?.ocr || context?.native?.word.length);
    get("unit").querySelector('option[value="word"]').textContent = context?.ocr ? "Palabras" : "Fragmentos";
    for (const button of panel.querySelectorAll("form button, [data-edit-transform]")) button.disabled = applying;
  }

  function boxOnScreen(viewport, [x0, y0, x1, y1]) {
    const a = viewport.convertToViewportPoint(x0, y0);
    const b = viewport.convertToViewportPoint(x1, y1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }

  function isScan(object, viewport) {
    if (object.type !== 3 && object.type !== 5) return false;
    const [x0, y0, x1, y1] = object.box;
    return Math.min(x1, viewport.width) - Math.max(0, x0) >= viewport.width * 0.82
      && Math.min(y1, viewport.height) - Math.max(0, y0) >= viewport.height * 0.82;
  }

  async function inspect(pageNum) {
    if (!enabled || !PdfViewer.hasDocument()) return;
    const token = ++revision;
    const keepOcr = context?.pageNum === pageNum ? context.ocr : null;
    const bytes = PdfViewer.getOriginalBytes();
    discardSelection();
    layer?.remove();
    context = null;
    updateControls();
    setStatus("Leyendo página " + pageNum + "…");
    try {
      const [objects, page] = await Promise.all([execute(bytes, pageNum), PdfViewer.getPdfDoc().getPage(pageNum)]);
      if (!enabled || revision !== token || bytes !== PdfViewer.getOriginalBytes()) return;
      const viewport = page.getViewport({ scale: 1 });
      for (const object of objects) object.box = boxOnScreen(viewport, object.bounds);
      // La imagen de página se conserva como objetivo de OCR aun después de insertar una corrección.
      const scan = objects.find((object) => object.type === 3 && isScan(object, viewport))
        || (!objects.some((object) => object.type === 1 && !object.hidden)
          ? objects.find((object) => object.type === 5 && isScan(object, viewport))
          : null);
      context = { pageNum, page, viewport, objects, scan: scan?.type === 3 ? scan : null, scanGroup: scan?.type === 5, ocr: keepOcr, native: PdfEditText.nativeRegions(objects, viewport) };
      render();
    } catch (err) {
      if (enabled && revision === token) setStatus(err.message);
    }
  }

  function place(element, box, viewport) {
    const [x0, y0, x1, y1] = box;
    element.style.left = (x0 / viewport.width * 100) + "%";
    element.style.top = (y0 / viewport.height * 100) + "%";
    element.style.width = ((x1 - x0) / viewport.width * 100) + "%";
    element.style.height = ((y1 - y0) / viewport.height * 100) + "%";
  }

  function statusFor(count) {
    if (mode === "objects") {
      if (selected) return "Arrastra el marco para mover el objeto o usa las flechas del teclado.";
      if (count) return "Toca una imagen o gráfico para seleccionarlo.";
      if (context.scan || context.scanGroup) return "Las imágenes dentro de una hoja escaneada forman parte de la foto.";
      return "Esta página no tiene objetos independientes compatibles.";
    }
    if (context.ocr) return count ? "Toca el texto detectado para corregirlo." : "OCR no encontró texto en esta página.";
    if (count) return "Toca el texto resaltado para corregirlo.";
    if (context.scan) return "Pulsa OCR para reconocer el texto de esta página escaneada.";
    if (context.scanGroup) return "Este escaneo está dentro de un grupo PDF. El OCR admite imágenes de página independientes.";
    return "No se encontró texto editable en esta página.";
  }

  function render() {
    layer?.remove();
    updateControls();
    if (!context || !enabled) return;
    const { pageNum, viewport, objects, ocr, scan, scanGroup } = context;
    const wrap = PdfViewer.getPageWrapEl(pageNum);
    if (!wrap) return;
    layer = document.createElement("div");
    layer.className = "pdf-edit-layer";
    wrap.append(layer);

    let targets;
    if (mode === "objects") {
      targets = objects.filter((object) => object.type !== 1 && object.id !== scan?.id
        && !(scanGroup && isScan(object, viewport)) && !isPageBackground(object, viewport));
    } else if (ocr) {
      targets = ocr.regions[get("unit").value].map((region) => ({
        ...region,
        targetOcr: true,
        originalBox: region.box,
        box: [
          region.box.x0 / ocr.viewport.width * viewport.width,
          region.box.y0 / ocr.viewport.height * viewport.height,
          region.box.x1 / ocr.viewport.width * viewport.width,
          region.box.y1 / ocr.viewport.height * viewport.height,
        ],
      }));
    } else {
      targets = context.native[get("unit").value];
    }

    let count = 0;
    for (const target of targets) {
      const [x0, y0, x1, y1] = target.box;
      if (x1 - x0 < 1 || y1 - y0 < 1 || x1 < 0 || y1 < 0 || x0 > viewport.width || y0 > viewport.height) continue;
      count++;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pdf-edit-target";
      if (target.id != null) button.dataset.pdfObject = target.id;
      button.setAttribute("aria-label", target.text ? "Corregir: " + target.text : (target.type === 3 ? "Imagen " : "Gráfico ") + count);
      place(button, target.box, viewport);
      button.addEventListener("click", () => choose(target, button));
      layer.append(button);
    }
    setStatus(statusFor(count));
  }

  function isPageBackground(object, viewport) {
    const [left, top, right, bottom] = object.box;
    const edge = 1;
    return object.type === 2 && left <= edge && top <= edge && right >= viewport.width - edge && bottom >= viewport.height - edge;
  }

  function choose(target, button) {
    if (applying || !context || readingOcr) return;
    discardSelection();
    selected = target;
    layer.querySelector("[aria-current]")?.removeAttribute("aria-current");
    layer.querySelector(".pdf-edit-frame")?.remove();
    button.setAttribute("aria-current", "true");
    if (mode === "text") {
      get("form").hidden = false;
      const input = get("input");
      input.value = target.text;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }
    get("transform").hidden = false;
    setStatus(statusFor(true));
    addFrame(button);
  }

  function addFrame(button) {
    const frame = document.createElement("button");
    frame.type = "button";
    frame.className = "pdf-edit-frame";
    frame.setAttribute("aria-label", "Mover objeto seleccionado");
    const { box } = selected;
    const { viewport } = context;
    place(frame, box, viewport);
    layer.append(frame);
    if (button.matches(":focus-visible")) frame.focus({ preventScroll: true });

    let drag;
    frame.addEventListener("pointerdown", (event) => {
      if (applying || !event.isPrimary || event.button !== 0) return;
      const rect = layer.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, sx: viewport.width / rect.width, sy: viewport.height / rect.height };
      frame.setPointerCapture(event.pointerId);
    });
    const offset = (event) => [(event.clientX - drag.x) * drag.sx, (event.clientY - drag.y) * drag.sy];
    frame.addEventListener("pointermove", (event) => {
      if (!drag || !event.isPrimary) return;
      const [dx, dy] = offset(event);
      place(frame, [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy], viewport);
    });
    frame.addEventListener("pointerup", (event) => {
      if (!drag || !event.isPrimary) return;
      const [dx, dy] = offset(event);
      const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4;
      drag = null;
      if (moved) transform({ dx, dy });
      else place(frame, box, viewport);
    });
    frame.addEventListener("lostpointercapture", () => {
      if (drag) place(frame, box, viewport);
      drag = null;
    });
    frame.addEventListener("keydown", (event) => {
      const offsets = { ArrowUp: [0, -4], ArrowDown: [0, 4], ArrowLeft: [-4, 0], ArrowRight: [4, 0] };
      const delta = offsets[event.key];
      if (!delta) return;
      event.preventDefault();
      transform({ dx: delta[0], dy: delta[1] });
    });
  }

  function transform({ dx = 0, dy = 0, scale = 1, angle = 0 }) {
    if (!selected || !context || applying) return;
    const { viewport } = context;
    const [left, top, right, bottom] = selected.box;
    const cos = Math.cos(angle) * scale;
    const sin = Math.sin(angle) * scale;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const output = (x, y) => viewport.convertToPdfPoint(
      cx + dx + cos * (x - cx) - sin * (y - cy),
      cy + dy + sin * (x - cx) + cos * (y - cy),
    );
    const xy = ([x, y]) => output(...viewport.convertToViewportPoint(x, y));
    const [e, f] = xy([0, 0]);
    const [ax, ay] = xy([1, 0]);
    const [bx, by] = xy([0, 1]);
    if (cx + dx < 0 || cy + dy < 0 || cx + dx > viewport.width || cy + dy > viewport.height) {
      render();
      setStatus("Mantén el centro del objeto dentro de la página.");
      return;
    }
    void apply({ kind: "transform", id: selected.id, matrix: [ax - e, ay - f, bx - e, by - f, e, f] }, selected.id);
  }

  function blockLayout(lines, box, text, viewport) {
    const first = lines[0];
    const last = lines.at(-1);
    const size = first.size;
    const advance = lines.length > 1 ? (last.baseline - first.baseline) / (lines.length - 1) : size;
    return PdfEditText.layout(text, { box, baseline: first.baseline, advance, size, font: first.font }, viewport);
  }

  function ocrBlockAction(target, text) {
    const { viewport } = context.ocr;
    const { x0, y0, x1, y1 } = target.originalBox;
    const box = [x0, y0, x1, y1];
    const lines = target.lines.map(({ box, baseline }) => ({
      size: (box.y1 - box.y0) / 0.75,
      baseline: baseline?.has_baseline ? baseline.y0 : box.y1,
      font: "Helvetica",
    }));
    const rect = ({ x0, y0, x1, y1 }) =>
      [[x0 - 1, y0 - 1], [x1 + 1, y0 - 1], [x0 - 1, y1 + 1], [x1 + 1, y1 + 1]].map((point) => viewport.convertToPdfPoint(...point));
    return {
      kind: "ocr",
      id: context.scan.id,
      corners: rect(target.originalBox),
      erase: target.lines.map((line) => rect(line.box)),
      replacementLines: blockLayout(lines, box, text, viewport),
    };
  }

  function ocrAction(target, text) {
    const { x0, y0, x1, y1 } = target.originalBox;
    const { viewport } = context.ocr;
    const line = target.baseline;
    const slope = line?.has_baseline && line.x1 !== line.x0 ? (line.y1 - line.y0) / (line.x1 - line.x0) : 0;
    const y = line?.has_baseline ? line.y0 + (x0 - line.x0) * slope : y1 - (y1 - y0) * 0.12;
    const pdf = (x, y) => viewport.convertToPdfPoint(x, y);
    const baseline = pdf(x0, y);
    const end = pdf(x1, y + (x1 - x0) * slope);
    const width = Math.hypot(end[0] - baseline[0], end[1] - baseline[1]);
    const direction = [(end[0] - baseline[0]) / width, (end[1] - baseline[1]) / width];
    const [a, b] = pdf(x0, y0);
    const [c, d] = pdf(x0, y1);
    return {
      kind: "ocr",
      id: context.scan.id,
      text,
      corners: [pdf(x0 - 1, y0 - 1), pdf(x1 + 1, y0 - 1), pdf(x0 - 1, y1 + 1), pdf(x1 + 1, y1 + 1)],
      baseline,
      direction,
      width,
      size: Math.hypot(c - a, d - b) / 0.75,
    };
  }

  async function runOcr() {
    if (!context?.scan || readingOcr || applying) return;
    const active = context;
    const token = revision;
    readingOcr = true;
    updateControls();
    setStatus("Preparando OCR…");
    try {
      const { recognizePage } = await import("./pdfEditOcr.mjs");
      active.ocr = await recognizePage(active.page, (progress) => {
        if (token !== revision) return;
        setStatus(progress === null ? "Cargando OCR…" : "Reconociendo texto… " + Math.round(progress * 100) + "%");
      });
      if (token === revision && enabled) render();
    } catch (err) {
      if (token === revision && enabled) setStatus(err.message || "No se pudo reconocer el texto.");
    } finally {
      readingOcr = false;
      updateControls();
    }
  }

  function remember(bytes, pageNum, wasEdited) {
    history.push({ bytes, pageNum, wasEdited });
    let total = history.reduce((size, entry) => size + entry.bytes.byteLength, 0);
    while (history.length > 1 && (history.length > 10 || total > maxHistoryBytes)) {
      total -= history.shift().bytes.byteLength;
    }
  }

  async function apply(action, reselectId) {
    if (!enabled || applying || !context) return;
    const { pageNum } = context;
    const bytes = PdfViewer.getOriginalBytes();
    const token = revision;
    applying = true;
    updateControls();
    setStatus("Aplicando cambio…");
    try {
      const next = await execute(bytes, pageNum, action);
      await PdfViewer.applyEditedPage(next, pageNum, bytes);
      remember(bytes, pageNum, edited);
      edited = true;
      if (token !== revision || !enabled) return;
      if (action.kind === "ocr") context.ocr = null;
      await inspect(pageNum);
      if (reselectId != null && mode === "objects") {
        const target = context?.objects.find((object) => object.id === reselectId);
        const button = layer?.querySelector('[data-pdf-object="' + reselectId + '"]');
        if (target && button) {
          applying = false;
          choose(target, button);
        }
      }
    } catch (err) {
      if (enabled) {
        if (action.kind === "transform") {
          const frame = layer?.querySelector(".pdf-edit-frame");
          if (frame && selected && context) place(frame, selected.box, context.viewport);
        }
        setStatus(err.message || "No se pudo aplicar el cambio.");
      }
    } finally {
      applying = false;
      updateControls();
    }
  }

  async function undo() {
    if (applying || !history.length) return;
    applying = true;
    updateControls();
    const last = history.at(-1);
    try {
      await PdfViewer.applyEditedPage(last.bytes, last.pageNum, PdfViewer.getOriginalBytes());
      history.pop();
      edited = last.wasEdited;
      await inspect(PdfViewer.getVisiblePage());
    } catch (err) {
      setStatus(err.message);
    } finally {
      applying = false;
      updateControls();
    }
  }

  function changeMode(nextMode) {
    if (applying) return;
    mode = nextMode;
    discardSelection();
    render();
  }

  function enter() {
    if (enabled || applying || !PdfViewer.hasDocument()) return;
    enabled = true;
    mode = "text";
    get("unit").value = "paragraph";
    panel.hidden = false;
    get("toggle").setAttribute("aria-expanded", "true");
    void inspect(PdfViewer.getVisiblePage());
  }

  get("toggle").addEventListener("click", () => {
    if (applying) return;
    if (enabled) leave();
    else enter();
  });
  get("text").addEventListener("click", () => changeMode("text"));
  get("objects").addEventListener("click", () => changeMode("objects"));
  get("ocr").addEventListener("click", () => void runOcr());
  get("undo").addEventListener("click", () => void undo());
  get("cancel").addEventListener("click", () => changeMode(mode));
  get("finish-object").addEventListener("click", () => changeMode(mode));
  get("unit").addEventListener("change", () => changeMode(mode));
  get("form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (applying || !selected) return;
    const text = get("input").value;
    if (text === selected.text) return changeMode(mode);
    if (selected.targetOcr) {
      if (selected.lines) void apply(ocrBlockAction(selected, text));
      else void apply(ocrAction(selected, text.replace(/\s+/g, " ")));
    } else if (selected.lines) {
      const replacementLines = blockLayout(selected.lines, selected.box, text, context.viewport);
      void apply({ kind: "block", ids: selected.ids, replacementLines });
    } else {
      void apply({ kind: "text", id: selected.id, text: text.replace(/\s+/g, " ") });
    }
  });
  get("transform").addEventListener("click", (event) => {
    const command = event.target.closest("[data-edit-transform]")?.dataset.editTransform;
    if (command === "smaller") transform({ scale: 0.9 });
    if (command === "larger") transform({ scale: 1.1 });
    if (command === "rotate") transform({ angle: Math.PI / 12 });
  });
  scroll.addEventListener("pdf-page-change", (event) => {
    if (!enabled || applying) return;
    clearTimeout(pageTimer);
    pageTimer = setTimeout(() => {
      if (enabled && !applying && event.detail.pageNum !== context?.pageNum) void inspect(event.detail.pageNum);
    }, 130);
  });

  return { enter, leave, reset, documentAppended, hasEdits: () => edited, isApplying: () => applying };
})();
