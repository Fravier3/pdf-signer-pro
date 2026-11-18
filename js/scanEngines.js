/** Dispatches PDF Pro and Nitidoc independently. Nitidoc uses its upstream worker protocol. */
const ScanEngines = (() => {
  const names = { pdfpro: "PDF Pro", nitidoc: "Nitidoc", scanic: "Scanic", quadscan: "Quadscan", compare: "Comparar motores" };
  const independent = (engine) => engine === "scanic" || engine === "quadscan";
  const openCvUrl = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";
  const openCvIntegrity = "sha256-GbRhZ7We+++cw4NiZLC2VxEIM+Sx34QoIAS4sxQcBI0=";
  const presets = { auto: "enhanced", color: "original", vivid: "enhanced", gray: "grayscale", bw: "bw", magic: "bw-high-contrast" };
  let worker, ready, idle, sequence = 0;
  const pending = new Map();

  function release() {
    clearTimeout(idle);
    worker?.terminate();
    worker = ready = null;
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Se cerró el motor de escaneo."));
    }
    pending.clear();
  }

  function request(type, data, transfer = []) {
    clearTimeout(idle);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(release, 45_000);
      pending.set(id, { resolve, reject, timeout });
      try {
        worker.postMessage({ id, type, ...data }, transfer);
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(id);
        idle = setTimeout(release, 30_000);
        reject(error);
      }
    });
  }

  function prepare(engine) {
    if (independent(engine)) return ScanRasters.run(engine, "prepare");
    if (engine !== "nitidoc") return Promise.resolve();
    if (ready) return ready;
    worker = new Worker(new URL("vendor/nitidoc/engine.js", document.baseURI));
    const active = worker;
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task || data.type === "PROGRESS") return;
      clearTimeout(task.timeout);
      pending.delete(data.id);
      if (!pending.size) idle = setTimeout(release, 30_000);
      if (data.type === "ERROR") task.reject(new Error(data.message));
      else task.resolve(data);
    };
    worker.onerror = release;
    ready = (async () => {
      // Fetch only this static dependency. The document never leaves the browser.
      const response = await fetch(openCvUrl, {
        integrity: openCvIntegrity, credentials: "omit", referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout?.(35_000),
      });
      if (!response.ok) throw new Error("No se pudo descargar OpenCV.");
      const url = URL.createObjectURL(await response.blob());
      try {
        if (worker !== active) throw new Error("Se cerró el motor de escaneo.");
        await request("INIT", { assetUrl: url });
      } finally {
        URL.revokeObjectURL(url);
      }
    })().catch((error) => {
      if (worker === active) release();
      throw error;
    });
    return ready;
  }

  function pixels(canvas) {
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  }

  function canvasFrom(response) {
    const { bitmap, image } = response;
    const { width, height } = bitmap || image;
    const result = ScanImage.canvas(width, height);
    const ctx = result.getContext("2d", { alpha: false, willReadFrequently: true });
    try {
      if (bitmap) ctx.drawImage(bitmap, 0, 0);
      else {
        for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
        ctx.putImageData(new ImageData(image.data, width, height), 0, 0);
      }
      return result;
    } finally {
      bitmap?.close();
    }
  }

  function measure(image) {
    const { width, height, data } = image;
    let mean = 0, sum = 0, square = 0, count = 0;
    const luma = (p) => (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const p = (y * width + x) * 4;
        const value = luma(p);
        const lap = 4 * value - luma(p - 4) - luma(p + 4) - luma(p - width * 4) - luma(p + width * 4);
        mean += value;
        sum += lap;
        square += lap * lap;
        count++;
      }
    }
    return { isDark: mean / count < 55, isBlurry: square / count - (sum / count) ** 2 < 45 };
  }

  async function detect(engine, canvas) {
    if (engine === "pdfpro") return { corners: ScanImage.detect(canvas), quality: measure(pixels(canvas)) };
    if (independent(engine)) {
      const image = pixels(canvas);
      const quality = measure(image);
      const found = await ScanRasters.run(engine, "detect", { image });
      const corners = found?.map(({ x, y }) => [
        ScanImage.clamp(x / (canvas.width - 1), 0, 1),
        ScanImage.clamp(y / (canvas.height - 1), 0, 1),
      ]);
      return { corners: corners && ScanImage.isQuad(corners) ? corners : null, quality };
    }
    await prepare(engine);
    const image = pixels(canvas);
    const response = await request("DETECT_IMAGEDATA", { image, withQuality: true }, [image.data.buffer]);
    const corners = response.corners?.map(({ x, y }) => [
      ScanImage.clamp(x / (canvas.width - 1), 0, 1),
      ScanImage.clamp(y / (canvas.height - 1), 0, 1),
    ]);
    return { corners: corners && ScanImage.isQuad(corners) ? corners : null, quality: response.quality };
  }

  async function rectify(engine, source, corners, limit) {
    if (engine === "pdfpro") return ScanImage.rectify(source, corners, limit);
    const full = ScanImage.fullFrame();
    if (corners.every(([x, y], i) => x === full[i][0] && y === full[i][1])) return source;
    const points = corners.map(([x, y]) => ({ x: x * (source.width - 1), y: y * (source.height - 1) }));
    if (independent(engine)) {
      const image = await ScanRasters.run(engine, "warp", { image: pixels(source), corners: points, limit });
      return canvasFrom({ image });
    }
    await prepare(engine);
    const image = pixels(source);
    const response = await request("WARP", {
      image,
      geometry: { mode: "measured" },
      corners: points,
    }, [image.data.buffer]);
    return canvasFrom(response);
  }

  function colorAdjust(canvas, saturation, sharpness) {
    if (!saturation && !sharpness) return;
    const context = canvas.getContext("2d");
    const image = pixels(canvas);
    const { data, width } = image;
    const luma = new Uint8Array(data.length / 4);
    for (let p = 0; p < luma.length; p++) luma[p] = (data[p * 4] * 77 + data[p * 4 + 1] * 150 + data[p * 4 + 2] * 29) >> 8;
    for (let p = 0; p < luma.length; p++) {
      const x = p % width;
      const edges = sharpness && p >= width && p < luma.length - width && x && x < width - 1;
      const detail = edges ? (luma[p] - (luma[p - 1] + luma[p + 1] + luma[p - width] + luma[p + width]) / 4) * sharpness / 60 : 0;
      for (let c = 0; c < 3; c++) data[p * 4 + c] += (data[p * 4 + c] - luma[p]) * saturation / 100 + detail;
    }
    context.putImageData(image, 0, 0);
  }

  async function render(flat, out, page) {
    const strength = { auto: .68, white: 1, vivid: .48, gray: .70, bw: .78, magic: .82 }[page.mode];
    let normalized;
    try {
      if (strength) {
        const image = await ScanRasters.run("scancat", "whiten", { image: pixels(flat), strength });
        normalized = canvasFrom({ image });
      }
      const sharedMode = page.mode === "white" || (page.mode === "auto" && page.engine !== "nitidoc") ? "color" : page.mode;
      await renderFiltered(normalized || flat, out, { ...page, mode: sharedMode });
    } finally {
      if (normalized) normalized.width = normalized.height = 1;
    }
  }

  async function renderFiltered(flat, out, page) {
    const { engine, mode, brightness, contrast, sharpness, saturation, rotation, skew } = page;
    const extraColor = mode === "vivid" ? 18 : 0;
    if (engine !== "nitidoc") {
      ScanImage.enhance(flat, out, { ...page, mode: mode === "magic" || mode === "vivid" ? "auto" : mode });
      colorAdjust(out, saturation + extraColor + (mode === "magic" ? 10 : 0), sharpness + (mode === "magic" ? 18 : 0));
      return;
    }
    await prepare(engine);
    let filtered;
    try {
      if (mode === "color" && !brightness && !contrast && !sharpness) filtered = flat;
      else {
        const image = pixels(flat);
        const response = await request("APPLY_FILTER", {
          image, variants: [{ preset: presets[mode], brightness, contrast, sharpness }], outputBitmap: false,
        }, [image.data.buffer]);
        filtered = canvasFrom(response.results[0]);
      }
      ScanImage.enhance(filtered, out, { mode: "color", brightness: 0, contrast: 0, rotation, skew });
      colorAdjust(out, saturation + extraColor, 0);
    } finally {
      if (filtered && filtered !== flat) filtered.width = filtered.height = 1;
    }
  }

  return { names, detect, prepare, rectify, release, render };
})();
