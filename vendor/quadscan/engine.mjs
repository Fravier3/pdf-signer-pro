/* Quadscan 1.0.0 · Sebastian Torrealba · MIT · adapted canvas allocation for Web Workers */

// ../../../tmp/pdfpro-quadsrc/decode.ts
var HEATMAP_SIZE = 128;
var DECODE_RADIUS = 4;
var CENTROID_THRESHOLD_RATIO = 0.3;
function decodeCorners(heatmap, sourceWidth, sourceHeight, minConfidence) {
  const H = HEATMAP_SIZE;
  const W = HEATMAP_SIZE;
  const C = 4;
  const sx = sourceWidth / W;
  const sy = sourceHeight / H;
  const corners = [];
  for (let c = 0; c < C; c++) {
    const off = c * H * W;
    let maxV = Number.NEGATIVE_INFINITY;
    let maxIdx = 0;
    for (let i = 0; i < H * W; i++) {
      const v = heatmap[off + i] ?? 0;
      if (v > maxV) {
        maxV = v;
        maxIdx = i;
      }
    }
    if (maxV < minConfidence) return null;
    const px = maxIdx % W;
    const py = (maxIdx - px) / W;
    const x0 = Math.max(0, px - DECODE_RADIUS);
    const x1 = Math.min(W - 1, px + DECODE_RADIUS);
    const y0 = Math.max(0, py - DECODE_RADIUS);
    const y1 = Math.min(H - 1, py + DECODE_RADIUS);
    const thr = CENTROID_THRESHOLD_RATIO * maxV;
    let sumW = 0;
    let sumX = 0;
    let sumY = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const v = heatmap[off + y * W + x] ?? 0;
        if (v >= thr) {
          sumW += v;
          sumX += v * x;
          sumY += v * y;
        }
      }
    }
    const cxH = sumW > 0 ? sumX / sumW : px;
    const cyH = sumW > 0 ? sumY / sumW : py;
    corners.push({
      x: cxH * sx,
      y: cyH * sy,
      confidence: maxV
    });
  }
  return corners;
}

// ../../../tmp/pdfpro-quadsrc/errors.ts
var QuadscanError = class extends Error {
  name = "QuadscanError";
  code;
  cause;
  constructor(message, code, cause) {
    super(message);
    this.code = code;
    if (cause !== void 0) this.cause = cause;
  }
};
var ModelLoadError = class extends QuadscanError {
  name = "ModelLoadError";
  constructor(url, status, cause) {
    const statusPart = status !== void 0 ? ` (HTTP ${status})` : "";
    super(
      `Could not fetch model from ${url}${statusPart}. Check the URL, the host CORS headers, or pre-bundle the .onnx as a static asset.`,
      "MODEL_LOAD_FAILED",
      cause
    );
  }
};
var InvalidInputError = class extends QuadscanError {
  name = "InvalidInputError";
  constructor(receivedType) {
    super(
      `Expected an HTMLImageElement, HTMLCanvasElement, HTMLVideoElement, ImageBitmap, ImageData, Blob, or File. Got: ${receivedType}.`,
      "INVALID_INPUT"
    );
  }
};
var DegenerateQuadError = class extends QuadscanError {
  name = "DegenerateQuadError";
  constructor(message) {
    super(message, "DEGENERATE_QUAD");
  }
};

// ../../../tmp/pdfpro-quadsrc/inference.ts
async function runInference(session, inputTensor, dims) {
  const ort = await import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.mjs");
  const tensor = new ort.Tensor("float32", inputTensor, dims);
  const out = await session.run({ img: tensor });
  const heatmap = out.heatmap;
  if (!heatmap) {
    throw new Error(
      `Model output missing expected "heatmap" tensor. Got: [${Object.keys(out).join(", ")}].`
    );
  }
  return {
    data: heatmap.data,
    dims: heatmap.dims
  };
}

// ../../../tmp/pdfpro-quadsrc/input.ts
async function coerceToCanvas(input) {
  if (typeof HTMLCanvasElement !== "undefined" && input instanceof HTMLCanvasElement || typeof OffscreenCanvas !== "undefined" && input instanceof OffscreenCanvas) {
    if (input.width === 0 || input.height === 0) {
      throw new InvalidInputError("HTMLCanvasElement with zero dimensions");
    }
    return input;
  }
  if (typeof HTMLImageElement !== "undefined" && input instanceof HTMLImageElement) {
    if (input.naturalWidth === 0 || input.naturalHeight === 0) {
      await input.decode();
    }
    return drawToFreshCanvas(input, input.naturalWidth, input.naturalHeight);
  }
  if (typeof HTMLVideoElement !== "undefined" && input instanceof HTMLVideoElement) {
    return drawToFreshCanvas(input, input.videoWidth, input.videoHeight);
  }
  if (typeof ImageBitmap !== "undefined" && input instanceof ImageBitmap) {
    return drawToFreshCanvas(input, input.width, input.height);
  }
  if (input instanceof ImageData) {
    const c = typeof document === "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    c.width = input.width;
    c.height = input.height;
    const ctx = c.getContext("2d");
    if (!ctx) throw new InvalidInputError("Could not obtain a 2D canvas context");
    ctx.putImageData(input, 0, 0);
    return c;
  }
  if (input instanceof Blob) {
    const bitmap = await createImageBitmap(input);
    try {
      return drawToFreshCanvas(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }
  const typeName = typeof input === "object" && input !== null ? input.constructor?.name ?? "object" : typeof input;
  throw new InvalidInputError(typeName);
}
function drawToFreshCanvas(source, width, height) {
  if (width === 0 || height === 0) {
    throw new InvalidInputError(
      `Source has zero dimensions (${width}\xD7${height}); image likely failed to decode`
    );
  }
  const c = typeof document === "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new InvalidInputError("Could not obtain a 2D canvas context");
  ctx.drawImage(source, 0, 0);
  return c;
}

// ../../../tmp/pdfpro-quadsrc/output.ts
function convertOutput(canvas, format) {
  switch (format) {
    case "canvas":
      return canvas;
    case "imagedata": {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("convertOutput: canvas has no 2D context");
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    case "dataurl":
      return canvas.toDataURL("image/png");
  }
}

// ../../../tmp/pdfpro-quadsrc/preprocess.ts
var MODEL_INPUT_SIZE = 256;
function preprocess(source, normalization) {
  const SIZE = MODEL_INPUT_SIZE;
  const off = typeof document === "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  off.width = SIZE;
  off.height = SIZE;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("preprocess: could not get 2D context");
  ctx.drawImage(source, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const tensor = new Float32Array(3 * SIZE * SIZE);
  const plane = SIZE * SIZE;
  const div = normalization === "minus-one-one" ? 127.5 : 255;
  const sub = normalization === "minus-one-one" ? 1 : 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    tensor[p] = data[i] / div - sub;
    tensor[p + plane] = data[i + 1] / div - sub;
    tensor[p + 2 * plane] = data[i + 2] / div - sub;
  }
  return {
    tensor,
    dims: [1, 3, SIZE, SIZE],
    sourceWidth: source.width,
    sourceHeight: source.height
  };
}

// ../../../tmp/pdfpro-quadsrc/progress.ts
function emitProgress(cb, event) {
  if (cb === void 0) return;
  try {
    cb(event);
  } catch {
  }
}

// ../../../tmp/pdfpro-quadsrc/reorder.ts
function reorderTLTRBRBL(corners) {
  if (corners.length !== 4) {
    throw new QuadscanError(
      `reorderTLTRBRBL: expected 4 corners, got ${corners.length}`,
      "INTERNAL_ERROR"
    );
  }
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
  let topLeft;
  let topRight;
  let bottomRight;
  let bottomLeft;
  for (const p of corners) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (dx < 0 && dy < 0) topLeft = p;
    else if (dx >= 0 && dy < 0) topRight = p;
    else if (dx >= 0 && dy >= 0) bottomRight = p;
    else bottomLeft = p;
  }
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
    throw new DegenerateQuadError(
      "Could not assign all four corners to distinct TL/TR/BR/BL quadrants. Likely causes: the corners are collinear, or the document is rotated more than ~45\xB0."
    );
  }
  return { topLeft, topRight, bottomRight, bottomLeft };
}

// ../../../tmp/pdfpro-quadsrc/session.ts
var PKG_VERSION = true ? "1.0.0" : "latest";
var MODEL_FILES = {
  lcnet: "models/lcnet100_h_e_bifpn_256_fp32.onnx",
  fastvit: "models/fastvit_t8_h_e_bifpn_256_fp32.onnx"
};
var NPM_BUNDLED = {
  lcnet: true,
  fastvit: false
};
var GH_REPO = "storrealbac/quadscan";
var ORT_VERSION = "1.20.1";
var DEFAULT_WASM_PATHS = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
function resolveModelUrl(opts) {
  if (opts.modelUrl) return opts.modelUrl;
  const preset = opts.model ?? "lcnet";
  if (NPM_BUNDLED[preset]) {
    return `https://cdn.jsdelivr.net/npm/quadscan@${PKG_VERSION}/${MODEL_FILES[preset]}`;
  }
  return `https://cdn.jsdelivr.net/gh/${GH_REPO}@v${PKG_VERSION}/${MODEL_FILES[preset]}`;
}
function resolveNormalization(url, opts) {
  if (opts.normalization) return opts.normalization;
  if (/fastvit/i.test(url)) return "minus-one-one";
  return "zero-one";
}
async function loadSession(opts, onProgress, signal) {
  const url = resolveModelUrl(opts);
  const normalization = resolveNormalization(url, opts);
  let response;
  try {
    response = await fetch(url, signal !== void 0 ? { signal } : {});
  } catch (cause) {
    throw new ModelLoadError(url, void 0, cause);
  }
  if (!response.ok) {
    throw new ModelLoadError(url, response.status);
  }
  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : 0;
  const chunks = [];
  let loaded = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.length;
        emitProgress(onProgress, {
          phase: "model-download",
          loaded,
          total: total || loaded
        });
      }
    }
  } else {
    const buf = new Uint8Array(await response.arrayBuffer());
    chunks.push(buf);
    loaded = buf.length;
    emitProgress(onProgress, { phase: "model-download", loaded, total: loaded });
  }
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    buffer.set(c, offset);
    offset += c.length;
  }
  emitProgress(onProgress, { phase: "model-compile" });
  const ort = await import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.mjs");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = opts.wasmPaths ?? DEFAULT_WASM_PATHS;
  const session = await ort.InferenceSession.create(buffer, {
    executionProviders: opts.executionProviders ?? ["webgpu", "wasm"],
    graphOptimizationLevel: "all"
  });
  return { session, normalization, modelUrl: url };
}

// ../../../tmp/pdfpro-quadsrc/homography.ts
function computeHomography(src, dst) {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error("computeHomography: needs exactly 4 source and 4 destination points");
  }
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(A, b);
  const H = new Float64Array(9);
  for (let i = 0; i < 8; i++) H[i] = h[i];
  H[8] = 1;
  return H;
}
function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w
  };
}
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let pivotVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col]);
      if (v > pivotVal) {
        pivot = row;
        pivotVal = v;
      }
    }
    if (pivotVal < 1e-12) {
      throw new Error("solve8: singular matrix (degenerate correspondences)");
    }
    if (pivot !== col) {
      [M[col], M[pivot]] = [M[pivot], M[col]];
    }
    const piv = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= piv;
    M[col][col] = 1;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n];
  return x;
}

// ../../../tmp/pdfpro-quadsrc/warp.ts
function warp(source, corners, maxOutputDimension) {
  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = corners;
  const widthTop = dist(tl, tr);
  const widthBot = dist(bl, br);
  const heightLeft = dist(tl, bl);
  const heightRight = dist(tr, br);
  let outW = Math.round(Math.max(widthTop, widthBot));
  let outH = Math.round(Math.max(heightLeft, heightRight));
  if (outW <= 0 || outH <= 0) {
    throw new Error("warp: degenerate quad (zero-length sides)");
  }
  const longest = Math.max(outW, outH);
  if (longest > maxOutputDimension) {
    const scale = maxOutputDimension / longest;
    outW = Math.max(1, Math.round(outW * scale));
    outH = Math.max(1, Math.round(outH * scale));
  }
  const dstPoints = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 }
  ];
  const srcPoints = [tl, tr, br, bl];
  const Hinv = computeHomography(dstPoints, srcPoints);
  const srcCtx = source.getContext("2d");
  if (!srcCtx) throw new Error("warp: source canvas has no 2D context");
  const srcImg = srcCtx.getImageData(0, 0, source.width, source.height);
  const srcData = srcImg.data;
  const srcW = source.width;
  const srcH = source.height;
  const out = typeof document === "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("warp: output canvas has no 2D context");
  const outImg = outCtx.createImageData(outW, outH);
  const outData = outImg.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sp = applyHomography(Hinv, x, y);
      const sx = sp.x;
      const sy = sp.y;
      if (sx < 0 || sy < 0 || sx > srcW - 1 || sy > srcH - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);
      const tx = sx - x0;
      const ty = sy - y0;
      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      const outIdx = (y * outW + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const v00 = srcData[i00 + ch];
        const v10 = srcData[i10 + ch];
        const v01 = srcData[i01 + ch];
        const v11 = srcData[i11 + ch];
        const a = v00 * (1 - tx) + v10 * tx;
        const b = v01 * (1 - tx) + v11 * tx;
        outData[outIdx + ch] = Math.round(a * (1 - ty) + b * ty);
      }
    }
  }
  outCtx.putImageData(outImg, 0, 0);
  return out;
}
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ../../../tmp/pdfpro-quadsrc/quadscan.ts
var DEFAULT_MAX_OUTPUT_DIM = 2048;
var DEFAULT_MIN_CONFIDENCE = 0.1;
var Quadscan = class _Quadscan {
  #opts;
  #loaded = null;
  #loading = null;
  /**
   * @param options Options that apply for the lifetime of this instance.
   *   `model` picks a built-in preset (`'lcnet'` default, `'fastvit'` opt-in).
   *   `modelUrl` overrides the model URL entirely. `executionProviders`
   *   chooses which ORT EPs to try (default `['webgpu', 'wasm']`).
   *   `wasmPaths` overrides where ORT looks for its `.wasm` runtimes.
   */
  constructor(options = {}) {
    this.#opts = { ...options };
  }
  /**
   * Eagerly download the model and create the ORT InferenceSession. Optional;
   * `scan()` and `extract()` will do this on first call if you skip it.
   * Useful when you want to amortize the load cost up front (e.g. during app
   * startup, while a UI shows a loading indicator).
   */
  async initialize() {
    await this.#ensureLoaded();
  }
  /**
   * Detect the four corners of a document in `input` and optionally warp it
   * to an axis-aligned rectangle.
   *
   * - `mode: 'detect'` (default) returns corners only; `output` is `null`.
   * - `mode: 'extract'` also returns the warped image in `output` according
   *   to the requested format (`canvas` | `imagedata` | `dataurl`).
   *
   * Detection failures (no document found) come back as
   * `{ success: false, message }`. System failures throw
   * (`ModelLoadError`, `InvalidInputError`, `DegenerateQuadError`,
   * native `AbortError`).
   *
   * @param input An `HTMLImageElement | HTMLCanvasElement | HTMLVideoElement |
   *   ImageBitmap | ImageData | Blob | File`.
   * @param options Per-call options (mode, output format, cancellation,
   *   progress, debug, confidence floor, max output size).
   * @returns A {@link ScanResult}. Check `result.success` before reading
   *   `corners` or `output`.
   * @throws ModelLoadError on fetch, parse, or compile failure.
   * @throws InvalidInputError if `input` is none of the supported types.
   * @throws DegenerateQuadError if the 4 corners can't form a quad.
   * @throws DOMException('AbortError') if `options.signal` was aborted.
   */
  async scan(input, options = {}) {
    const mode = options.mode ?? "detect";
    const outputFormat = options.output ?? "canvas";
    const maxDim = options.maxOutputDimension ?? DEFAULT_MAX_OUTPUT_DIM;
    const minConf = options.minDetectionConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const signal = options.signal;
    const onProgress = options.onProgress;
    const timings = [];
    throwIfAborted(signal);
    const loaded = await this.#ensureLoaded(onProgress, signal);
    throwIfAborted(signal);
    const t0 = performance.now();
    const canvas = await coerceToCanvas(input);
    emitProgress(onProgress, { phase: "preprocess" });
    const { tensor, dims, sourceWidth, sourceHeight } = preprocess(canvas, loaded.normalization);
    timings.push({ step: "preprocess", ms: performance.now() - t0 });
    throwIfAborted(signal);
    const t1 = performance.now();
    emitProgress(onProgress, { phase: "inference" });
    const output = await runInference(loaded.session, tensor, dims);
    timings.push({ step: "inference", ms: performance.now() - t1 });
    throwIfAborted(signal);
    const t2 = performance.now();
    emitProgress(onProgress, { phase: "decode" });
    const raw = decodeCorners(output.data, sourceWidth, sourceHeight, minConf);
    timings.push({ step: "decode", ms: performance.now() - t2 });
    if (raw === null) {
      return {
        success: false,
        message: `No document detected (peak confidence below threshold ${minConf}).`,
        confidence: null,
        output: null,
        corners: null,
        timings,
        debug: options.debug ? { heatmap: output.data, rawCorners: [] } : null
      };
    }
    const t3 = performance.now();
    const corners = reorderTLTRBRBL(raw);
    timings.push({ step: "reorder", ms: performance.now() - t3 });
    const minCornerConf = Math.min(
      corners.topLeft.confidence,
      corners.topRight.confidence,
      corners.bottomRight.confidence,
      corners.bottomLeft.confidence
    );
    let renderedOutput = null;
    if (mode === "extract") {
      throwIfAborted(signal);
      const t4 = performance.now();
      emitProgress(onProgress, { phase: "warp" });
      const warped = warp(canvas, corners, maxDim);
      timings.push({ step: "warp", ms: performance.now() - t4 });
      renderedOutput = convertOutput(warped, outputFormat);
    }
    return {
      success: true,
      message: "OK",
      confidence: minCornerConf,
      output: renderedOutput,
      corners,
      timings,
      debug: options.debug ? { heatmap: output.data, rawCorners: raw } : null
    };
  }
  /**
   * Perspective-warp `input` using the supplied `corners`, skipping detection.
   * Use this when corners come from elsewhere (user adjustment, prior scan,
   * another detector).
   *
   * Each corner needs `{ x, y }` in source-image pixel coordinates; `confidence`
   * is optional and defaults to 1.
   *
   * @throws InvalidInputError if `corners` is missing required fields or
   *   `input` is not a supported type.
   */
  async extract(input, corners, options = {}) {
    const filled = validateAndFillCorners(corners);
    const canvas = await coerceToCanvas(input);
    const maxDim = options.maxOutputDimension ?? DEFAULT_MAX_OUTPUT_DIM;
    const outputFormat = options.output ?? "canvas";
    const t = performance.now();
    const warped = warp(canvas, filled, maxDim);
    const ms = performance.now() - t;
    return {
      success: true,
      message: "OK",
      confidence: Math.min(
        filled.topLeft.confidence,
        filled.topRight.confidence,
        filled.bottomRight.confidence,
        filled.bottomLeft.confidence
      ),
      output: convertOutput(warped, outputFormat),
      corners: filled,
      timings: [{ step: "warp", ms }],
      debug: null
    };
  }
  /**
   * Release the ORT InferenceSession and its WASM memory. Subsequent
   * `scan()` calls will re-initialize on next use. Idempotent.
   */
  dispose() {
    if (this.#loaded) {
      void this.#loaded.session.release?.();
      this.#loaded = null;
    }
    this.#loading = null;
  }
  /** Allows `using q = new Quadscan()` to auto-dispose at scope exit. */
  [Symbol.dispose]() {
    this.dispose();
  }
  // ───────────────────────────────────────────────────────────────────
  // Static singleton convenience methods
  // ───────────────────────────────────────────────────────────────────
  static #shared = null;
  static #getShared() {
    if (!_Quadscan.#shared) _Quadscan.#shared = new _Quadscan();
    return _Quadscan.#shared;
  }
  /**
   * One-shot detection via the internal singleton. Lazily creates an instance
   * with default options on first call. Same semantics as the instance method.
   * Release with {@link Quadscan.disposeShared} when you're done.
   */
  static scan(input, options) {
    return _Quadscan.#getShared().scan(input, options ?? {});
  }
  /**
   * One-shot warp via the internal singleton. Does not invoke the model
   * (the singleton's session is not initialized by this call alone).
   */
  static extract(input, corners, options) {
    return _Quadscan.#getShared().extract(input, corners, options ?? {});
  }
  /**
   * Release the shared singleton's InferenceSession and forget it.
   * The next `Quadscan.scan` / `Quadscan.extract` will lazily create a new
   * singleton. Idempotent.
   */
  static disposeShared() {
    if (_Quadscan.#shared) {
      _Quadscan.#shared.dispose();
      _Quadscan.#shared = null;
    }
  }
  #ensureLoaded(onProgress, signal) {
    if (this.#loaded) return Promise.resolve(this.#loaded);
    if (this.#loading) return this.#loading;
    this.#loading = loadSession(this.#opts, onProgress, signal).then((loaded) => {
      this.#loaded = loaded;
      return loaded;
    }).finally(() => {
      this.#loading = null;
    });
    return this.#loading;
  }
};
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}
var CORNER_KEYS = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
function validateAndFillCorners(corners) {
  if (!corners || typeof corners !== "object") {
    throw new InvalidInputError(`corners: ${corners === null ? "null" : typeof corners}`);
  }
  const bag = corners;
  for (const key of CORNER_KEYS) {
    const c = bag[key];
    if (!c || typeof c !== "object") {
      throw new InvalidInputError(
        `corners.${key}: missing or not an object (expected { x, y, confidence? })`
      );
    }
    if (typeof c.x !== "number" || typeof c.y !== "number") {
      throw new InvalidInputError(
        `corners.${key}: x and y must be numbers (got x=${typeof c.x}, y=${typeof c.y})`
      );
    }
  }
  return {
    topLeft: {
      x: corners.topLeft.x,
      y: corners.topLeft.y,
      confidence: corners.topLeft.confidence ?? 1
    },
    topRight: {
      x: corners.topRight.x,
      y: corners.topRight.y,
      confidence: corners.topRight.confidence ?? 1
    },
    bottomRight: {
      x: corners.bottomRight.x,
      y: corners.bottomRight.y,
      confidence: corners.bottomRight.confidence ?? 1
    },
    bottomLeft: {
      x: corners.bottomLeft.x,
      y: corners.bottomLeft.y,
      confidence: corners.bottomLeft.confidence ?? 1
    }
  };
}
export {
  Quadscan
};
