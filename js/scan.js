const Scan = (() => {
  const get = (name) => document.getElementById("scan-" + name);
  const pages = [];
  const PREVIEW_EDGE = 1120;
  const PDF_EDGE = 5760;
  const DEFAULT_STATUS = "Encuadra la hoja completa para detectar sus bordes.";
  const FAVORITE_KEY = "pdfpro-scan-favorite";
  const engineButtons = [...get("engine-grid").querySelectorAll("[data-engine]")];
  const compareDialog = get("compare");
  const zoomDialog = get("zoom");
  let favorite;
  try { favorite = localStorage.getItem(FAVORITE_KEY); } catch {}
  if (!["pdfpro", "nitidoc"].includes(favorite)) favorite = null;
  let engine = favorite || "pdfpro";
  let retake = -1;
  let comparisonUrls = [];
  let previewVersion = 0;
  let previewRunning = false;
  let selected = -1;
  let source, flat, crop, busy = false;
  let previewFrame = 0;
  let openPdf, onIdle;
  const controls = ["camera", "import", "crop", "reset-crop", "apply-crop", "filter", "brightness",
    "contrast", "saturation", "sharpness", "rotate", "earlier", "later", "remove", "open-pdf", "clear", "retake", "classic", "favorite", "format"];

  function lock(value) {
    busy = value;
    controls.forEach((name) => { get(name).disabled = value; });
    get("earlier").disabled = value || selected < 1;
    get("later").disabled = value || selected >= pages.length - 1;
    get("page-list").querySelectorAll("button").forEach((button) => { button.disabled = value; });
    engineButtons.forEach((button) => { button.disabled = value; });
    get("favorite").disabled = value || engine === "compare";
    if (!busy) onIdle();
  }

  function status(message) {
    get("status").textContent = message;
  }

  function hideLoupe() {
    get("loupe").hidden = true;
  }

  // Lupa: acerca la zona bajo el dedo y se pone al otro lado de la foto para que el dedo no la tape.
  function showLoupe(index) {
    const loupe = get("loupe");
    const original = get("original");
    const stage = get("crop-stage");
    const [x, y] = crop[index];
    const side = Math.min(original.width, original.height, Math.max(original.width, original.height) * 0.06);
    const left = ScanImage.clamp(x * original.width - side / 2, 0, original.width - side);
    const top = ScanImage.clamp(y * original.height - side / 2, 0, original.height - side);
    const context = loupe.getContext("2d");
    context.drawImage(original, left, top, side, side, 0, 0, loupe.width, loupe.height);
    // La mira marca la esquina exacta, aunque esté pegada al borde de la foto.
    const mx = (x * original.width - left) / side * loupe.width;
    const my = (y * original.height - top) / side * loupe.height;
    context.strokeStyle = "#7f77ff";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(mx, my - 14);
    context.lineTo(mx, my + 14);
    context.moveTo(mx - 14, my);
    context.lineTo(mx + 14, my);
    context.stroke();
    const size = loupe.offsetWidth || 104;
    const height = original.clientHeight || stage.clientHeight;
    loupe.style.left = x > 0.5 ? "6px" : Math.max(6, original.clientWidth - size - 6) + "px";
    loupe.style.top = ScanImage.clamp(y * height - size / 2, 6, Math.max(6, height - size - 6)) + "px";
    loupe.hidden = false;
  }

  function setCrop(points) {
    hideLoupe();
    crop = points;
    get("crop-stage").hidden = !crop;
    get("crop-actions").hidden = !crop;
    get("preview").hidden = !!crop;
    get("adjustments").hidden = !!crop;
    get("crop").setAttribute("aria-pressed", String(!!crop));
    get("crop").textContent = crop ? "Cancelar recorte" : "Ajustar bordes";
    if (crop) drawHandles();
  }

  function drawHandles() {
    const percent = crop.map(([x, y]) => [x * 100, y * 100]);
    get("crop-outline").querySelector("polygon").setAttribute("points", percent.map((point) => point.join(",")).join(" "));
    get("crop-stage").querySelectorAll(".scan-handle").forEach((handle, i) => {
      handle.style.left = percent[i][0] + "%";
      handle.style.top = percent[i][1] + "%";
    });
  }

  function queuePreview() {
    previewVersion++;
    cancelAnimationFrame(previewFrame);
    if (previewRunning) return;
    previewFrame = requestAnimationFrame(async () => {
      const page = pages[selected];
      if (!page || !flat) return;
      const version = previewVersion;
      const result = ScanImage.canvas(1, 1);
      previewRunning = true;
      try {
        await ScanEngines.render(flat, result, { ...page });
        if (version !== previewVersion || page !== pages[selected]) return;
        const preview = get("preview");
        preview.width = result.width;
        preview.height = result.height;
        preview.getContext("2d").drawImage(result, 0, 0);
        const thumb = ScanImage.canvas(72, 86);
        const scale = Math.min(72 / preview.width, 86 / preview.height);
        const width = preview.width * scale;
        const height = preview.height * scale;
        thumb.getContext("2d").drawImage(preview, (72 - width) / 2, (86 - height) / 2, width, height);
        page.thumbnail = thumb.toDataURL();
        const image = get("page-list").children[selected]?.querySelector("img");
        if (image) image.src = page.thumbnail;
      } catch (error) {
        if (version === previewVersion) status("No se pudo mostrar la vista previa. Intenta de nuevo.");
      } finally {
        result.width = result.height = 1;
        previewRunning = false;
        if (version !== previewVersion) queuePreview();
      }
    });
  }

  function selectEngine(value, announce = true) {
    engine = value;
    for (const button of engineButtons) {
      if (!button.hasAttribute("aria-disabled")) button.setAttribute("aria-pressed", String(engine === button.dataset.engine));
    }
    get("classic").setAttribute("aria-pressed", String(engine === "pdfpro"));
    get("active-engine").textContent = ScanEngines.names[engine];
    const star = get("favorite");
    star.disabled = engine === "compare";
    star.setAttribute("aria-pressed", String(engine === favorite));
    star.textContent = engine === favorite ? "Quitar favorito" : "Marcar favorito";
    get("import-input").multiple = engine !== "compare";
    if (announce) status(engine === "compare" ? "Toma o elige una foto para comparar Nitidoc y PDF Pro." : DEFAULT_STATUS);
  }

  function refresh() {
    const page = pages[selected];
    get("editor").hidden = !page;
    get("retake").hidden = !page;
    get("pages").hidden = !pages.length;
    get("count").textContent = pages.length === 1 ? "1 página" : pages.length + " páginas";
    get("camera-label").textContent = pages.length ? "Escanear otra" : "Escanear página";
    get("page-list").replaceChildren(...pages.map((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scan-page-thumb";
      button.disabled = busy;
      button.setAttribute("aria-label", "Editar página " + (index + 1));
      button.setAttribute("aria-pressed", String(index === selected));
      const image = new Image();
      image.alt = "";
      if (item.thumbnail) image.src = item.thumbnail;
      button.append(image, String(index + 1));
      button.addEventListener("click", () => run(async () => {
        await select(index);
        if (pages[index].detected) status("Página enderezada. Puedes revisar sus bordes.");
      }));
      return button;
    }));
    if (!page) { previewVersion++; return; }
    get("editor-title").textContent = "Página " + (selected + 1);
    const name = document.createElement("small");
    name.textContent = ScanEngines.names[page.engine];
    get("editor-title").append(name);
    get("filter").value = page.mode;
    get("brightness").value = page.brightness;
    get("contrast").value = page.contrast;
    get("saturation").value = page.saturation;
    get("sharpness").value = page.sharpness;
    queuePreview();
  }

  async function select(index) {
    const page = pages[index];
    const next = page ? await ScanImage.read(page.file, PREVIEW_EDGE) : null;
    let corrected;
    try {
      corrected = next ? await ScanEngines.rectify(page.engine, next, page.corners, PREVIEW_EDGE) : null;
    } catch (error) {
      if (next) next.width = next.height = 1;
      throw error;
    }
    if (flat && flat !== source) flat.width = flat.height = 1;
    if (source) source.width = source.height = 1;
    selected = index;
    source = next;
    flat = corrected;
    setCrop(null);
    refresh();
    if (page && !page.detected) status("Revisa los bordes. Puedes ajustar las cuatro esquinas a mano.");
  }

  async function run(action, failure = "Ocurrió un problema. Intenta de nuevo.") {
    if (busy) return;
    lock(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      status(failure);
      Toast.show(failure);
    } finally {
      lock(false);
    }
  }

  async function analyze(file, motor) {
    const probe = await ScanImage.read(file, 720);
    let image, corrected;
    try {
      const { corners: detected, quality } = await ScanEngines.detect(motor, probe);
      const corners = detected || ScanImage.fullFrame();
      image = await ScanImage.read(file, 2240);
      corrected = await ScanEngines.rectify(motor, image, corners, 2240);
      const turn = ScanImage.orientation(corrected);
      const page = {
        file, engine: motor, corners, detected: Boolean(detected), quality,
        mode: "auto", brightness: 0, contrast: 0, saturation: 0, sharpness: 0,
        rotation: turn.rotation, skew: turn.skew,
      };
      const thumb = ScanImage.canvas(1, 1);
      const reduced = ScanImage.canvas(...ScanImage.imageSize(corrected.width, corrected.height, 96));
      reduced.getContext("2d").drawImage(corrected, 0, 0, reduced.width, reduced.height);
      await ScanEngines.render(reduced, thumb, page);
      page.thumbnail = thumb.toDataURL();
      return page;
    } finally {
      for (const canvas of new Set([probe, image, corrected])) if (canvas) canvas.width = canvas.height = 1;
    }
  }

  async function addFiles(files, motor, replacement = -1) {
    const first = pages.length;
    let last = -1, failed = 0;
    for (const [index, file] of files.entries()) {
      status("Procesando foto " + (index + 1) + " de " + files.length + "…");
      try {
        const page = await analyze(file, motor);
        if (replacement >= 0) {
          pages[replacement] = page;
          last = replacement;
        } else {
          last = pages.push(page) - 1;
        }
      } catch (error) {
        console.warn("Error procesando foto", error);
        failed++;
      }
    }
    if (last >= 0) {
      await select(last);
      get("page-list").children[last]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const { detected, quality } = pages[last];
      const message = detected ? "Página enderezada." : "Revisa las cuatro esquinas.";
      status([message, quality?.isDark && "Poca luz.", quality?.isBlurry && "La foto podría estar borrosa."].filter(Boolean).join(" "));
    }
    if (failed) {
      const detail = motor === "nitidoc" && pages.length === first && last < 0
        ? "Nitidoc no pudo procesar la imagen. Revisa la conexión inicial del motor o prueba con JPG o PNG."
        : "Algunas fotos no se pudieron procesar. Prueba con JPG o PNG.";
      status(detail);
      Toast.show(detail);
    }
  }

  async function renderPage(page) {
    const image = await ScanImage.read(page.file, PDF_EDGE, 12_500_000);
    const output = ScanImage.canvas(1, 1);
    let corrected;
    try {
      corrected = await ScanEngines.rectify(page.engine, image, page.corners, PDF_EDGE);
      if (corrected !== image) image.width = image.height = 1;
      await ScanEngines.render(corrected, output, page);
      const { width, height } = output;
      const blob = await new Promise((resolve) => output.toBlob(resolve, "image/jpeg", 0.98));
      if (!blob) throw new Error("No se pudo codificar la página");
      return { blob, width, height };
    } finally {
      for (const canvas of new Set([image, corrected, output])) if (canvas) canvas.width = canvas.height = 1;
    }
  }

  function openZoom(url, label) {
    const image = get("zoom-image");
    get("zoom-title").textContent = label;
    image.alt = label;
    get("zoom-level").value = 1;
    image.style.width = "100%";
    image.src = url;
    zoomDialog.showModal();
    get("zoom-viewport").scrollTo(0, 0);
  }

  function showResult(label, result, use) {
    const card = document.createElement("article");
    card.className = "scan-result";
    const heading = document.createElement("strong");
    heading.textContent = label;
    const stats = document.createElement("p");
    card.append(heading);
    if (result.blob) {
      const url = URL.createObjectURL(result.blob);
      comparisonUrls.push(url);
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "scan-result-image";
      zoom.setAttribute("aria-label", "Ampliar " + label);
      const image = new Image();
      image.alt = "";
      image.src = url;
      zoom.append(image);
      zoom.addEventListener("click", () => openZoom(url, label));
      card.append(zoom);
      const size = new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(result.blob.size / 1024);
      stats.textContent = [`${result.width} × ${result.height}`, size + " KB",
        result.elapsed == null ? null : Math.round(result.elapsed) + " ms"].filter(Boolean).join(" · ");
    } else {
      stats.textContent = result.message;
    }
    card.append(stats);
    if (use) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn primary";
      button.textContent = "Usar " + label;
      button.addEventListener("click", use);
      button.disabled = true;
      card.append(button);
    }
    get("compare-results").append(card);
  }

  async function compare(file, replacement) {
    compareDialog.showModal();
    const live = get("compare-status");
    live.textContent = "Preparando la foto original…";
    const url = URL.createObjectURL(file);
    try {
      const original = new Image();
      original.src = url;
      await original.decode();
      if (!compareDialog.open) return;
      showResult("Original", { blob: file, width: original.naturalWidth, height: original.naturalHeight });
    } catch (error) {
      compareDialog.close();
      throw error;
    } finally {
      URL.revokeObjectURL(url);
    }
    for (const motor of ["nitidoc", "pdfpro"]) {
      if (!compareDialog.open) return;
      const label = ScanEngines.names[motor];
      live.textContent = "Procesando con " + label + "…";
      try {
        await ScanEngines.prepare(motor);
        const start = performance.now();
        const page = await analyze(file, motor);
        const result = await renderPage(page);
        if (!compareDialog.open) return;
        showResult(label, { ...result, elapsed: performance.now() - start }, () => run(async () => {
          await selectForComparison(page, replacement);
          compareDialog.close();
          status(label + " añadido al PDF.");
        }));
      } catch (error) {
        if (!compareDialog.open) return;
        console.warn(error);
        showResult(label, { message: "No se pudo procesar esta foto." });
      }
    }
    showResult("Scanlio", { message: "Permiso de redistribución pendiente." });
    showResult("Scanner", { message: "Permiso de redistribución pendiente." });
    get("compare-results").querySelectorAll(".btn.primary").forEach((button) => { button.disabled = false; });
    live.textContent = "Amplía las imágenes y elige el resultado para tu PDF.";
  }

  async function selectForComparison(page, replacement) {
    const index = replacement >= 0 ? replacement : pages.length;
    const previous = pages[index];
    pages[index] = page;
    try { await select(index); }
    catch (error) {
      if (previous) pages[index] = previous;
      else pages.pop();
      throw error;
    }
  }

  function editCrop() {
    if (crop) return setCrop(null);
    const original = get("original");
    original.width = source.width;
    original.height = source.height;
    original.getContext("2d").drawImage(source, 0, 0);
    setCrop(pages[selected].corners);
  }

  function moveHandle(index, x, y) {
    const next = crop.slice();
    next[index] = [ScanImage.clamp(x, 0, 1), ScanImage.clamp(y, 0, 1)];
    if (!ScanImage.isQuad(next)) return;
    crop = next;
    drawHandles();
  }

  function swap(offset) {
    const next = selected + offset;
    [pages[next], pages[selected]] = [pages[selected], pages[next]];
    selected = next;
    refresh();
    lock(false);
  }

  async function createPdf() {
    const pdf = await PDFLib.PDFDocument.create();
    const sizes = { letter: [612, 792], a4: [595.28, 841.89] };
    const paper = sizes[get("format").value];
    for (const [index, page] of pages.entries()) {
      status("Preparando página " + (index + 1) + " de " + pages.length + "…");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { blob, width, height } = await renderPage(page);
      const embedded = await pdf.embedJpg(await blob.arrayBuffer());
      const originalScale = 792 / Math.max(width, height);
      const [pageWidth, pageHeight] = !paper
        ? [width * originalScale, height * originalScale]
        : width > height ? [paper[1], paper[0]] : paper;
      const scale = Math.min(pageWidth / width, pageHeight / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const output = pdf.addPage([pageWidth, pageHeight]);
      if (paper) output.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PDFLib.rgb(1, 1, 1) });
      output.drawImage(embedded, {
        x: (pageWidth - drawWidth) / 2, y: (pageHeight - drawHeight) / 2, width: drawWidth, height: drawHeight,
      });
    }
    const date = new Date();
    const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
    const opened = await openPdf(new File([await pdf.save()], "Escaneo-" + stamp + ".pdf", { type: "application/pdf" }));
    status(opened ? "PDF creado. Puedes seguir editando estas páginas." : "Tus páginas están listas para generar el PDF.");
  }

  function init(options) {
    ({ openPdf, onIdle } = options);
    const receive = (files, motor, replacement) => motor === "compare"
      ? compare(files[0], replacement) : addFiles(files, motor, replacement);
    ScanCamera.init({
      onPhoto: (file, motor) => run(() => {
        ScanCamera.close();
        return receive([file], motor, retake);
      }),
      onClose: onIdle,
    });
    get("camera").addEventListener("click", () => {
      retake = -1;
      ScanCamera.open(engine);
    });
    get("retake").addEventListener("click", () => {
      retake = selected;
      ScanCamera.open(pages[selected].engine);
    });
    for (const button of engineButtons) button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") === "true") {
        status(button.querySelector("strong").textContent + " requiere permiso de redistribución.");
        return;
      }
      selectEngine(button.dataset.engine);
    });
    get("classic").addEventListener("click", () => selectEngine("pdfpro"));
    get("favorite").addEventListener("click", () => {
      favorite = engine === favorite ? null : engine;
      try {
        if (favorite) localStorage.setItem(FAVORITE_KEY, favorite);
        else localStorage.removeItem(FAVORITE_KEY);
      } catch {}
      selectEngine(engine, false);
      status(favorite ? ScanEngines.names[favorite] + " guardado como favorito." : "Favorito eliminado.");
    });
    selectEngine(engine, false);
    compareDialog.addEventListener("close", () => {
      for (const url of comparisonUrls) URL.revokeObjectURL(url);
      comparisonUrls = [];
      get("compare-results").replaceChildren();
      onIdle();
    });
    const zoomLevel = get("zoom-level");
    const viewport = get("zoom-viewport");
    function resizeZoom() {
      get("zoom-image").style.width = (Number(zoomLevel.value) * 100) + "%";
    }
    zoomLevel.addEventListener("input", resizeZoom);
    let pinchStart = null;
    const span = ([a, b]) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    viewport.addEventListener("touchstart", (event) => {
      if (event.touches.length === 2) pinchStart = [span(event.touches), Number(zoomLevel.value)];
    }, { passive: true });
    viewport.addEventListener("touchmove", (event) => {
      if (!pinchStart || event.touches.length !== 2) return;
      event.preventDefault();
      zoomLevel.value = ScanImage.clamp(pinchStart[1] * span(event.touches) / Math.max(1, pinchStart[0]), 1, 6);
      resizeZoom();
    }, { passive: false });
    for (const type of ["touchend", "touchcancel"]) viewport.addEventListener(type, () => { pinchStart = null; });
    zoomDialog.addEventListener("close", () => get("zoom-image").removeAttribute("src"));
    const input = get("import-input");
    get("import").addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const files = Array.from(input.files);
      input.value = "";
      if (files.length) run(() => receive(files, engine, -1));
    });
    get("crop").addEventListener("click", editCrop);
    get("reset-crop").addEventListener("click", () => run(async () => {
      const { corners } = await ScanEngines.detect(pages[selected].engine, source);
      setCrop(corners || ScanImage.fullFrame());
    }));
    get("apply-crop").addEventListener("click", () => run(async () => {
      const page = pages[selected];
      const corrected = await ScanEngines.rectify(page.engine, source, crop, PREVIEW_EDGE);
      if (flat !== source) flat.width = flat.height = 1;
      flat = corrected;
      page.corners = crop;
      page.detected = true;
      const turn = ScanImage.orientation(flat);
      page.skew = turn.rotation === page.rotation ? turn.skew : 0;
      setCrop(null);
      queuePreview();
      status("Recorte aplicado.");
    }));
    get("crop-stage").querySelectorAll(".scan-handle").forEach((handle, index) => {
      handle.addEventListener("pointerdown", (event) => {
        handle.setPointerCapture(event.pointerId);
        showLoupe(index);
      });
      handle.addEventListener("pointermove", (event) => {
        if (!handle.hasPointerCapture(event.pointerId)) return;
        const rect = get("original").getBoundingClientRect();
        moveHandle(index, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        showLoupe(index);
      });
      for (const end of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(end, hideLoupe);
      handle.addEventListener("keydown", (event) => {
        const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const [x, y] = crop[index];
        moveHandle(index, x + offset[0] * 0.01, y + offset[1] * 0.01);
      });
    });
    for (const [id, property] of [["filter", "mode"], ["brightness", "brightness"], ["contrast", "contrast"], ["saturation", "saturation"], ["sharpness", "sharpness"]]) {
      get(id).addEventListener("input", (event) => {
        pages[selected][property] = id === "filter" ? event.target.value : Number(event.target.value);
        queuePreview();
      });
    }
    get("rotate").addEventListener("click", () => {
      const page = pages[selected];
      page.rotation = (page.rotation + 1) % 4;
      queuePreview();
    });
    get("earlier").addEventListener("click", () => swap(-1));
    get("later").addEventListener("click", () => swap(1));
    get("remove").addEventListener("click", () => run(async () => {
      pages.splice(selected, 1);
      await select(Math.min(selected, pages.length - 1));
      if (!pages.length) status("Encuadra la hoja completa para detectar sus bordes.");
    }));
    get("clear").addEventListener("click", () => run(async () => {
      const confirmed = await UI.Dialog.confirm({
        title: "¿Vaciar el escaneo?", message: "Se quitarán todas las páginas de esta sesión.",
        confirmText: "Vaciar", danger: true,
      });
      if (!confirmed) return;
      pages.length = 0;
      await select(-1);
      status("Encuadra la hoja completa para detectar sus bordes.");
    }));
    get("open-pdf").addEventListener("click", () => run(createPdf, "No se pudo crear el PDF. Tus páginas siguen aquí."));
  }

  return { init, hasWork: () => busy || pages.length > 0 || ScanCamera.isOpen() || compareDialog.open };
})();
