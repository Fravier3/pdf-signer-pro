/** Procesamiento local de imágenes del escáner. */
const ScanImage = (() => {
  const fullFrame = () => [[0, 0], [1, 0], [1, 1], [0, 1]];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, fraction) => a + (b - a) * fraction;
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  const isQuad = (points) => points.every((point, i) =>
    cross(point, points[(i + 1) % 4], points[(i + 2) % 4]) > 0.002
  );

  function canvas(width, height) {
    const element = document.createElement("canvas");
    element.width = width;
    element.height = height;
    return element;
  }

  function imageSize(width, height, limit = 4096) {
    const scale = Math.min(1, limit / Math.max(width, height), Math.sqrt(9_000_000 / (width * height)));
    return [Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale))];
  }

  async function read(file, limit) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const result = canvas(...imageSize(image.naturalWidth, image.naturalHeight, limit));
      const context = result.getContext("2d", { alpha: false, willReadFrequently: true });
      context.imageSmoothingQuality = "high";
      context.fillStyle = "#fff";
      context.fillRect(0, 0, result.width, result.height);
      context.drawImage(image, 0, 0, result.width, result.height);
      return result;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function detect(source) {
    const scale = Math.min(1, 320 / Math.max(source.width, source.height));
    const reduced = canvas(Math.round(source.width * scale), Math.round(source.height * scale));
    const { width, height } = reduced;
    if (Math.min(width, height) < 25) return null;
    const context = reduced.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const luma = new Uint8Array(width * height);
    for (let i = 0; i < luma.length; i++) {
      const offset = i * 4;
      luma[i] = (rgba[offset] * 77 + rgba[offset + 1] * 150 + rgba[offset + 2] * 29) >> 8;
    }

    // Cada borde vota por líneas con la orientación de su gradiente.
    const angles = Array.from({ length: 90 }, (_, index) => {
      const angle = index * Math.PI / 90;
      return [Math.cos(angle), Math.sin(angle)];
    });
    const radius = Math.ceil(Math.hypot(width, height) / 2) + 1;
    const votes = angles.map(() => new Float32Array(radius * 2 + 1));
    const cx = width / 2, cy = height / 2;
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const i = y * width + x;
        const gx = luma[i + 1] - luma[i - 1] + (luma[i + width + 1] - luma[i + width - 1]) / 2
          + (luma[i - width + 1] - luma[i - width - 1]) / 2;
        const gy = luma[i + width] - luma[i - width] + (luma[i + width + 1] - luma[i - width + 1]) / 2
          + (luma[i + width - 1] - luma[i - width - 1]) / 2;
        const strength = Math.hypot(gx, gy);
        if (strength < 28) continue;
        const center = Math.round(Math.atan2(gy, gx) * 90 / Math.PI);
        for (let delta = -3; delta <= 3; delta++) {
          const angle = (center + delta + 180) % 90;
          const [nx, ny] = angles[angle];
          const offset = Math.round((x - cx) * nx + (y - cy) * ny) + radius;
          votes[angle][offset] += Math.min(strength / 70, 1.5);
        }
      }
    }

    const sides = [[], [], [], []]; // izquierda, derecha, arriba, abajo
    angles.forEach(([nx, ny], angle) => {
      const vertical = Math.abs(nx) > Math.abs(ny);
      const row = votes[angle];
      for (let i = 1; i < row.length - 1; i++) {
        const score = row[i - 1] + row[i] + row[i + 1];
        if (score < (vertical ? height : width) * 0.13) continue;
        const r = i - radius;
        const offset = r / (vertical ? nx : ny);
        const size = vertical ? width : height;
        if (Math.abs(offset) < size * 0.09 || Math.abs(offset) > size * 0.58) continue;
        const side = (vertical ? 0 : 2) + Number(offset > 0);
        sides[side].push({ nx, ny, r, offset, score });
      }
    });
    const [left, right, top, bottom] = sides.map((lines) => {
      const best = [];
      lines.sort((a, b) => b.score - a.score);
      for (const line of lines) {
        if (best.some((other) => Math.abs(line.offset - other.offset) < 5)) continue;
        best.push(line);
        if (best.length === 5) break;
      }
      return best;
    });

    function intersection(a, b) {
      const determinant = a.nx * b.ny - a.ny * b.nx;
      return [
        ((a.r * b.ny - a.ny * b.r) / determinant + cx) / width,
        ((a.nx * b.r - a.r * b.nx) / determinant + cy) / height,
      ];
    }

    let best = null;
    let bestScore = 0;
    for (const l of left) for (const r of right) for (const t of top) for (const b of bottom) {
      const points = [intersection(l, t), intersection(r, t), intersection(r, b), intersection(l, b)];
      if (points.some((point) => point.some((coord) => !Number.isFinite(coord) || coord < -0.025 || coord > 1.025))) continue;
      if (!isQuad(points)) continue;
      const area = (cross(points[0], points[1], points[2]) + cross(points[0], points[2], points[3])) / 2;
      if (area < 0.20 || area > 0.99) continue;
      const score = (l.score + r.score + t.score + b.score) * Math.sqrt(area);
      if (score > bestScore) {
        bestScore = score;
        best = points.map((point) => point.map((coord) => clamp(coord, 0, 1)));
      }
    }
    return best;
  }

  function rectify(source, points, limit) {
    if (Math.max(source.width, source.height) <= limit &&
      fullFrame().every(([x, y], i) => x === points[i][0] && y === points[i][1])) return source;

    const [a, b, c, d] = points.map(([x, y]) => [x * (source.width - 1), y * (source.height - 1)]);
    // Proyección inversa del rectángulo al cuadrilátero de la foto.
    const width = (distance(a, b) + distance(d, c)) / 2 + 1;
    const height = (distance(a, d) + distance(b, c)) / 2 + 1;
    const target = canvas(...imageSize(width, height, limit));
    const context = target.getContext("2d", { willReadFrequently: true });
    const pixels = source.getContext("2d").getImageData(0, 0, source.width, source.height).data;
    const rectified = context.createImageData(target.width, target.height);
    const dx1 = b[0] - c[0], dx2 = d[0] - c[0];
    const dy1 = b[1] - c[1], dy2 = d[1] - c[1];
    const sx = a[0] - b[0] + c[0] - d[0], sy = a[1] - b[1] + c[1] - d[1];
    const determinant = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - dx2 * sy) / determinant;
    const h = (dx1 * sy - sx * dy1) / determinant;
    const ax = b[0] - a[0] + g * b[0], bx = d[0] - a[0] + h * d[0];
    const ay = b[1] - a[1] + g * b[1], by = d[1] - a[1] + h * d[1];

    for (let y = 0, i = 0; y < target.height; y++) {
      const v = y / (target.height - 1);
      for (let x = 0; x < target.width; x++, i += 4) {
        const u = x / (target.width - 1);
        const z = 1 + g * u + h * v;
        const px = clamp((a[0] + ax * u + bx * v) / z, 0, source.width - 1);
        const py = clamp((a[1] + ay * u + by * v) / z, 0, source.height - 1);
        const ix = Math.min(source.width - 2, Math.floor(px)), fx = px - ix;
        const iy = Math.min(source.height - 2, Math.floor(py)), fy = py - iy;
        const first = (iy * source.width + ix) * 4, second = first + source.width * 4;
        for (let channel = 0; channel < 3; channel++) {
          const upper = pixels[first + channel] * (1 - fx) + pixels[first + 4 + channel] * fx;
          const lower = pixels[second + channel] * (1 - fx) + pixels[second + 4 + channel] * fx;
          rectified.data[i + channel] = upper * (1 - fy) + lower * fy;
        }
        rectified.data[i + 3] = 255;
      }
    }
    context.putImageData(rectified, 0, 0);
    return target;
  }

  const luminance = (data, i) => (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  const LIGHT_GRID = 10;

  function paperGains(luma, width, height) {
    const grid = LIGHT_GRID;
    const gains = new Float32Array(grid * grid);
    const bins = new Uint32Array(32);
    for (let row = 0; row < grid; row++) {
      const top = Math.floor(row * height / grid);
      const bottom = Math.floor((row + 1) * height / grid);
      const stepY = Math.max(1, Math.floor((bottom - top) / 24));
      for (let column = 0; column < grid; column++) {
        const left = Math.floor(column * width / grid);
        const right = Math.floor((column + 1) * width / grid);
        const stepX = Math.max(1, Math.floor((right - left) / 24));
        bins.fill(0);
        let count = 0;
        for (let y = top; y < bottom; y += stepY) {
          for (let x = left; x < right; x += stepX) {
            bins[luma[y * width + x] >> 3]++;
            count++;
          }
        }
        // Los tonos más claros de cada zona estiman el papel bajo su propia luz.
        let tone = 31;
        let bright = bins[tone];
        while (tone > 0 && bright < count * 0.20) bright += bins[--tone];
        gains[row * grid + column] = clamp(244 / (tone * 8 + 7), 1, 1.65);
      }
    }
    return gains;
  }

  function enhance(source, target, { mode, brightness, contrast, rotation }) {
    const turned = rotation % 2 !== 0;
    target.width = turned ? source.height : source.width;
    target.height = turned ? source.width : source.height;
    const context = target.getContext("2d", { willReadFrequently: true });
    context.save();
    context.translate(target.width / 2, target.height / 2);
    context.rotate(rotation * Math.PI / 2);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    context.restore();
    if (mode === "color" && brightness === 0 && contrast === 0) return;

    const { width, height } = target;
    const pixels = context.getImageData(0, 0, width, height);
    const { data } = pixels;
    const automatic = mode === "auto";
    const factor = (1 + contrast / 100) * (automatic ? 1.11 : 1);
    const light = brightness * 1.3;
    const luma = automatic ? new Uint8Array(width * height) : null;
    if (luma) for (let i = 0; i < luma.length; i++) luma[i] = luminance(data, i * 4);
    const gains = luma && paperGains(luma, width, height);
    const grid = LIGHT_GRID;

    for (let y = 0, p = 0; y < height; y++) {
      const row = clamp((y + 0.5) * grid / height - 0.5, 0, grid - 1);
      const top = Math.floor(row);
      const bottom = Math.min(top + 1, grid - 1);
      for (let x = 0; x < width; x++, p++) {
        const offset = p * 4;
        let gain = 1;
        let detail = 0;
        if (gains) {
          const column = clamp((x + 0.5) * grid / width - 0.5, 0, grid - 1);
          const left = Math.floor(column);
          const right = Math.min(left + 1, grid - 1);
          const upper = mix(gains[top * grid + left], gains[top * grid + right], column - left);
          const lower = mix(gains[bottom * grid + left], gains[bottom * grid + right], column - left);
          gain = mix(upper, lower, row - top);

          // Realce suave de trazos, con límite para evitar halos grandes.
          if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
            const neighbors = (luma[p - 1] + luma[p + 1] + luma[p - width] + luma[p + width]) / 4;
            const edge = luma[p] - neighbors;
            detail = Math.abs(edge) > 5 ? clamp(edge * 0.36, -18, 18) : 0;
          }
        }
        const gray = mode === "gray" ? luminance(data, offset) : null;
        for (let channel = 0; channel < 3; channel++) {
          const value = gray ?? data[offset + channel];
          data[offset + channel] = (value * gain + detail - 128) * factor + 128 + light;
        }
      }
    }
    context.putImageData(pixels, 0, 0);
  }

  return { canvas, clamp, detect, enhance, fullFrame, imageSize, isQuad, read, rectify };
})();
