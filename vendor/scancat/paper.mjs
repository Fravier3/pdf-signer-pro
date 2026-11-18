/* Scancat paper normalization · Nipun Batra · MIT */
export function grayFromRGBA(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return g;
}

/** Local mean via a summed-area table. `g` is Float32 0..255. */
function boxMean(g, w, h, r) {
  const W = w + 1;
  const sat = new Float64Array(W * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += g[(y - 1) * w + (x - 1)];
      sat[y * W + x] = sat[(y - 1) * W + x] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** Separable max filter (grey dilation) — lifts thin ink out of the background estimate. */
function maxFilter(g, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let k = x0; k <= x1; k++) { const v = g[row + k]; if (v > m) m = v; }
      tmp[row + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = y0; k <= y1; k++) { const v = tmp[k * w + x]; if (v > m) m = v; }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Per-pixel gain that flattens uneven lighting so paper reads as uniform white. */
export function paperGain(gray, w, h) {
  const rMax = Math.max(2, Math.round(Math.min(w, h) / 250));
  const lifted = maxFilter(gray, w, h, rMax);
  const bg = boxMean(lifted, w, h, Math.max(8, Math.round(Math.min(w, h) / 24)));
  const gain = new Float32Array(w * h);
  for (let i = 0; i < gain.length; i++) {
    let g = 236 / Math.max(bg[i], 30);
    if (g < 0.6) g = 0.6; else if (g > 4) g = 4;
    gain[i] = g;
  }
  return gain;
}
