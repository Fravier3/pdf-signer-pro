const Scan = (() => {
  const get = (name) => document.getElementById("scan-" + name);
  const pages = [];
  let selected = -1;
  let source, flat, crop, busy = false;
  let previewFrame = 0;
  let openPdf, onIdle;
  const controls = ["camera", "import", "crop", "reset-crop", "apply-crop", "filter", "brightness",
    "contrast", "rotate", "earlier", "later", "remove", "open-pdf", "clear"];

  function lock(value) {
    busy = value;
    controls.forEach((name) => { get(name).disabled = value; });
    get("earlier").disabled = value || selected < 1;
    get("later").disabled = value || selected >= pages.length - 1;
    get("page-list").querySelectorAll("button").forEach((button) => { button.disabled = value; });
    if (!busy) onIdle();
  }

  function status(message) {
    get("status").textContent = message;
  }

  function setCrop(points) {
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
    cancelAnimationFrame(previewFrame);
    const page = pages[selected];
    previewFrame = requestAnimationFrame(() => {
      if (page !== pages[selected] || !flat) return;
      const preview = get("preview");
      ScanImage.enhance(flat, preview, page);
      const thumb = ScanImage.canvas(72, 86);
      const scale = Math.min(72 / preview.width, 86 / preview.height);
      const width = preview.width * scale;
      const height = preview.height * scale;
      thumb.getContext("2d").drawImage(preview, (72 - width) / 2, (86 - height) / 2, width, height);
      page.thumbnail = thumb.toDataURL();
      const img = get("page-list").children[selected]?.querySelector("img");
      if (img) img.src = page.thumbnail;
    });
  }

  function refresh() {
    const page = pages[selected];
    get("editor").hidden = !page;
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
    if (!page) return;
    get("editor-title").textContent = "Página " + (selected + 1);
    get("filter").value = page.mode;
    get("brightness").value = page.brightness;
    get("contrast").value = page.contrast;
    queuePreview();
  }

  async function select(index) {
    const page = pages[index];
    const next = page ? await ScanImage.read(page.file, 900) : null;
    const corrected = next ? ScanImage.rectify(next, page.corners, 760) : null;
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

  async function addFiles(files, capturedCorners) {
    const first = pages.length;
    let skipped = 0;
    for (const file of files) {
      status("Procesando foto " + (pages.length - first + skipped + 1) + " de " + files.length + "…");
      try {
        const image = await ScanImage.read(file, 900);
        const detected = capturedCorners || ScanImage.detect(image);
        const corners = detected || ScanImage.fullFrame();
        const thumb = ScanImage.canvas(1, 1);
        ScanImage.enhance(ScanImage.rectify(image, corners, 96), thumb, {
          mode: "auto", brightness: 0, contrast: 0, rotation: 0,
        });
        pages.push({ file, corners, detected: !!detected, thumbnail: thumb.toDataURL(),
          mode: "auto", brightness: 0, contrast: 0, rotation: 0 });
      } catch {
        skipped++;
      }
    }
    if (pages.length > first) {
      await select(pages.length - 1);
      get("page-list").lastElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (pages[selected].detected) status("Página enderezada. Puedes escanear otra o crear el PDF.");
    }
    if (skipped) {
      const message = "Algunas fotos no se pudieron abrir. Prueba con una foto JPG o PNG.";
      status(message);
      Toast.show(message);
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
    const output = ScanImage.canvas(1, 1);
    for (const [index, page] of pages.entries()) {
      status("Preparando página " + (index + 1) + " de " + pages.length + "…");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const image = await ScanImage.read(page.file, 2200);
      ScanImage.enhance(ScanImage.rectify(image, page.corners, 2000), output, page);
      const blob = await new Promise((resolve) => output.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("No se pudo procesar una página");
      const embedded = await pdf.embedJpg(await blob.arrayBuffer());
      const scale = 792 / Math.max(embedded.width, embedded.height);
      const width = embedded.width * scale;
      const height = embedded.height * scale;
      pdf.addPage([width, height]).drawImage(embedded, { x: 0, y: 0, width, height });
    }
    const date = new Date();
    const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
    const opened = await openPdf(new File([await pdf.save()], "Escaneo-" + stamp + ".pdf", { type: "application/pdf" }));
    status(opened ? "PDF creado. Puedes seguir editando estas páginas." : "Tus páginas están listas para generar el PDF.");
  }

  function init(options) {
    ({ openPdf, onIdle } = options);
    ScanCamera.init({
      onPhoto: (file, capturedCorners) => run(() => {
        ScanCamera.close();
        return addFiles([file], capturedCorners);
      }),
      onClose: onIdle,
    });
    get("camera").addEventListener("click", ScanCamera.open);
    const input = get("import-input");
    get("import").addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const files = Array.from(input.files);
      input.value = "";
      if (files.length) run(() => addFiles(files));
    });
    get("crop").addEventListener("click", editCrop);
    get("reset-crop").addEventListener("click", () => setCrop(ScanImage.detect(source) || ScanImage.fullFrame()));
    get("apply-crop").addEventListener("click", () => {
      const page = pages[selected];
      flat = ScanImage.rectify(source, crop, 760);
      page.corners = crop;
      page.detected = true;
      setCrop(null);
      queuePreview();
      status("Recorte aplicado.");
    });
    get("crop-stage").querySelectorAll(".scan-handle").forEach((handle, index) => {
      handle.addEventListener("pointerdown", (event) => handle.setPointerCapture(event.pointerId));
      handle.addEventListener("pointermove", (event) => {
        if (!handle.hasPointerCapture(event.pointerId)) return;
        const rect = get("original").getBoundingClientRect();
        moveHandle(index, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      });
      handle.addEventListener("keydown", (event) => {
        const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const [x, y] = crop[index];
        moveHandle(index, x + offset[0] * 0.01, y + offset[1] * 0.01);
      });
    });
    for (const [id, property] of [["filter", "mode"], ["brightness", "brightness"], ["contrast", "contrast"]]) {
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

  return { init, hasWork: () => busy || pages.length > 0 || ScanCamera.isOpen() };
})();
