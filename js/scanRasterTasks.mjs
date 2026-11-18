const cornerNames = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
const engines = {};
const asset = (path) => new URL(`../vendor/${path}`, import.meta.url).href;

async function getEngine(id) {
  if (engines[id]) return engines[id];
  engines[id] = (async () => {
    const module = await import(asset(`${id}/engine.mjs`));
    const scanner = id === "scanic" ? new module.Scanner()
      : new module.Quadscan({ executionProviders: ["wasm"] });
    await scanner.initialize();
    return scanner;
  })().catch((error) => {
    delete engines[id];
    throw error;
  });
  return engines[id];
}

function canvas(width, height) {
  if (typeof document === "undefined") return new OffscreenCanvas(width, height);
  const result = document.createElement("canvas");
  result.width = width;
  result.height = height;
  return result;
}

function imageCanvas({ width, height, data }) {
  const output = canvas(width, height);
  output.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
  return output;
}

async function whiten(image, strength) {
  const { grayFromRGBA, paperGain } = await import(asset("scancat/paper.mjs"));
  const { data, width, height } = image;
  const ratio = Math.min(1, 640 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  const small = canvas(w, h);
  const ctx = small.getContext("2d", { willReadFrequently: true });
  const original = imageCanvas(image);
  ctx.drawImage(original, 0, 0, w, h);
  original.width = original.height = 1;
  const gray = grayFromRGBA(ctx.getImageData(0, 0, w, h).data, w, h);
  const gain = paperGain(gray, w, h);
  small.width = small.height = 1;

  // Scancat estimates the light field at reduced resolution. Interpolate only
  // that field, then apply it to the original pixels without reducing detail.
  for (let y = 0, p = 0; y < height; y++) {
    const sy = y * (h - 1) / Math.max(1, height - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, h - 1);
    for (let x = 0; x < width; x++, p += 4) {
      const sx = x * (w - 1) / Math.max(1, width - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, w - 1);
      const top = gain[y0 * w + x0] + (gain[y0 * w + x1] - gain[y0 * w + x0]) * (sx - x0);
      const bottom = gain[y1 * w + x0] + (gain[y1 * w + x1] - gain[y1 * w + x0]) * (sx - x0);
      const correction = (top + (bottom - top) * (sy - y0)) * 255 / 236;
      const light = Math.max(data[p], data[p + 1], data[p + 2]);
      const chroma = light - Math.min(data[p], data[p + 1], data[p + 2]);
      const paper = Math.max(0, Math.min(1, (light - 45) / 118)) * Math.max(.14, 1 - chroma / 64);
      const factor = 1 + Math.max(0, Math.min(.85, correction - 1)) * strength * paper;
      const neutralize = chroma < 37 ? paper * strength * Math.max(0, (light * factor - 185) / 100) : 0;
      for (let c = 0; c < 3; c++) data[p + c] = (data[p + c] + (light - data[p + c]) * neutralize) * factor;
    }
  }
  return image;
}

export async function perform({ id, operation, image, corners, limit, strength }) {
  if (operation === "whiten") return whiten(image, strength);
  const scanner = await getEngine(id);
  if (operation === "prepare") return null;
  const source = id === "scanic"
    ? new ImageData(image.data, image.width, image.height)
    : imageCanvas(image);
  try {
    if (operation === "detect") {
      const result = await scanner.scan(source, { mode: "detect" });
      return result.success ? cornerNames.map((key) => result.corners[key]) : null;
    }
    const points = Object.fromEntries(cornerNames.map((key, index) => [key, corners[index]]));
    const result = await scanner.extract(source, points, {
      output: "imagedata", maxOutputDimension: limit,
    });
    if (!result.success) throw new Error(result.message || "No se pudo corregir la perspectiva.");
    return result.output;
  } finally {
    if (id === "quadscan") source.width = source.height = 1;
  }
}
