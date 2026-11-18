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

  // Reduce la imagen y prepara dos planos: brillo y "papel" (brillo menos color).
  // El papel es claro y casi gris, así que un fondo de color con el mismo brillo se distingue mejor.
  function reduce(source, edge = 320) {
    const scale = Math.min(1, edge / Math.max(source.width, source.height));
    const reduced = canvas(Math.round(source.width * scale), Math.round(source.height * scale));
    const { width, height } = reduced;
    if (Math.min(width, height) < 25) return null;
    const context = reduced.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const luma = new Uint8Array(width * height);
    const paper = new Uint8Array(width * height);
    for (let i = 0; i < luma.length; i++) {
      const offset = i * 4;
      const r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2];
      const y = (r * 77 + g * 150 + b * 29) >> 8;
      luma[i] = y;
      paper[i] = clamp(y - (Math.max(r, g, b) - Math.min(r, g, b)) * 0.6, 0, 255);
    }
    return { luma, paper, width, height };
  }

  const STRICT = { minStrength: 28, votes: 0.13, minArea: 0.20 };
  const LOOSE = { minStrength: 14, votes: 0.085, minArea: 0.18 };

  // Cada borde vota por líneas con la orientación de su gradiente.
  function findLines(plane, width, height, { minStrength, votes: voteShare, minArea }) {
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
        const gx = plane[i + 1] - plane[i - 1] + (plane[i + width + 1] - plane[i + width - 1]) / 2
          + (plane[i - width + 1] - plane[i - width - 1]) / 2;
        const gy = plane[i + width] - plane[i - width] + (plane[i + width + 1] - plane[i - width + 1]) / 2
          + (plane[i + width - 1] - plane[i - width - 1]) / 2;
        const strength = Math.hypot(gx, gy);
        if (strength < minStrength) continue;
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
        if (score < (vertical ? height : width) * voteShare) continue;
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
      if (area < minArea || area > 0.99) continue;
      const score = (l.score + r.score + t.score + b.score) * Math.sqrt(area);
      if (score > bestScore) {
        bestScore = score;
        best = points.map((point) => point.map((coord) => clamp(coord, 0, 1)));
      }
    }
    return best;
  }

  function otsu(plane) {
    const histogram = new Uint32Array(256);
    for (let i = 0; i < plane.length; i++) histogram[plane[i]]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];
    let below = 0, weightBelow = 0, best = 0, threshold = 128, contrast = 0;
    for (let t = 0; t < 256; t++) {
      weightBelow += histogram[t];
      const weightAbove = plane.length - weightBelow;
      if (!weightBelow) continue;
      if (!weightAbove) break;
      below += t * histogram[t];
      const meanBelow = below / weightBelow;
      const meanAbove = (sum - below) / weightAbove;
      const between = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
      if (between > best) {
        best = between;
        threshold = t;
        contrast = meanAbove - meanBelow;
      }
    }
    return { threshold, contrast };
  }

  // Recta que mejor encaja con los puntos de un borde, ignorando los que se salen
  // (una esquina doblada, una sombra, una curva del papel).
  function fitLine(points) {
    let used = points;
    let line = null;
    for (let pass = 0; pass < 4 && used.length >= 6; pass++) {
      const n = used.length;
      let mx = 0, my = 0;
      for (const [x, y] of used) { mx += x; my += y; }
      mx /= n; my /= n;
      let sxx = 0, sxy = 0, syy = 0;
      for (const [x, y] of used) {
        sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my);
      }
      const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const nx = -Math.sin(angle), ny = Math.cos(angle);
      const r = nx * mx + ny * my;
      line = { nx, ny, r, count: n };
      const residuals = points.map(([x, y]) => Math.abs(nx * x + ny * y - r));
      const ordered = residuals.slice().sort((a, b) => a - b);
      const limit = Math.max(1.2, ordered[Math.floor(ordered.length * 0.6)] * 2.5);
      used = points.filter((_, i) => residuals[i] <= limit);
    }
    return line;
  }

  // Segmenta la hoja (clara) del fondo y ajusta cuatro rectas a su contorno.
  // Las rectas se prolongan hasta cruzarse, así una esquina doblada no recorta el documento.
  function findSheet({ paper, width, height }) {
    const { threshold, contrast } = otsu(paper);
    if (contrast < 28) return null;
    const total = width * height;
    const label = new Int32Array(total);
    const stack = new Int32Array(total);
    let bestLabel = 0, bestSize = 0, next = 0;
    for (let start = 0; start < total; start++) {
      if (paper[start] <= threshold || label[start]) continue;
      next++;
      let size = 0, top = 0;
      stack[top++] = start;
      label[start] = next;
      while (top) {
        const p = stack[--top];
        size++;
        const x = p % width;
        if (x > 0 && paper[p - 1] > threshold && !label[p - 1]) { label[p - 1] = next; stack[top++] = p - 1; }
        if (x < width - 1 && paper[p + 1] > threshold && !label[p + 1]) { label[p + 1] = next; stack[top++] = p + 1; }
        if (p >= width && paper[p - width] > threshold && !label[p - width]) { label[p - width] = next; stack[top++] = p - width; }
        if (p < total - width && paper[p + width] > threshold && !label[p + width]) { label[p + width] = next; stack[top++] = p + width; }
      }
      if (size > bestSize) { bestSize = size; bestLabel = next; }
    }
    if (bestSize < total * 0.18 || bestSize > total * 0.97) return null;

    // Puntos del contorno exterior: primer y último píxel de cada fila y de cada columna.
    const samples = [];
    for (let y = 0; y < height; y++) {
      let first = -1, last = -1;
      for (let x = 0; x < width; x++) if (label[y * width + x] === bestLabel) { if (first < 0) first = x; last = x; }
      if (first >= 0) samples.push([first, y + 0.5], [last + 1, y + 0.5]);
    }
    for (let x = 0; x < width; x++) {
      let first = -1, last = -1;
      for (let y = 0; y < height; y++) if (label[y * width + x] === bestLabel) { if (first < 0) first = y; last = y; }
      if (first >= 0) samples.push([x + 0.5, first], [x + 0.5, last + 1]);
    }
    const extreme = (score) => samples.reduce((best, point) => (score(point) > score(best) ? point : best), samples[0]);
    const rough = [
      extreme(([x, y]) => -(x + y)), extreme(([x, y]) => x - y),
      extreme(([x, y]) => x + y), extreme(([x, y]) => y - x),
    ]; // arriba-izq., arriba-der., abajo-der., abajo-izq.

    const diagonal = Math.hypot(width, height);
    const groups = [[], [], [], []]; // arriba, derecha, abajo, izquierda
    for (const point of samples) {
      let pick = -1, pickDistance = diagonal * 0.04;
      for (let k = 0; k < 4; k++) {
        const a = rough[k], b = rough[(k + 1) % 4];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const length = Math.hypot(dx, dy);
        if (!length) continue;
        const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (length * length);
        if (t < 0.12 || t > 0.88) continue; // las esquinas no cuentan: ahí es donde se dobla el papel
        const d = Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
        if (d < pickDistance) { pick = k; pickDistance = d; }
      }
      if (pick >= 0) groups[pick].push(point);
    }
    const lines = groups.map(fitLine);
    if (lines.some((line) => !line || line.count < 8)) return null;

    const meet = (a, b) => {
      const determinant = a.nx * b.ny - a.ny * b.nx;
      if (Math.abs(determinant) < 0.05) return [NaN, NaN];
      return [(a.r * b.ny - a.ny * b.r) / determinant, (a.nx * b.r - a.r * b.nx) / determinant];
    };
    const corners = [meet(lines[3], lines[0]), meet(lines[0], lines[1]), meet(lines[1], lines[2]), meet(lines[2], lines[3])];
    const points = corners.map(([x, y]) => [x / width, y / height]);
    if (points.some((point) => point.some((coord) => !Number.isFinite(coord) || coord < -0.05 || coord > 1.05))) return null;
    if (!isQuad(points)) return null;
    const area = (cross(points[0], points[1], points[2]) + cross(points[0], points[2], points[3])) / 2;
    if (area < 0.18 || area > 0.99) return null;

    const result = points.map((point) => point.map((coord) => clamp(coord, 0, 1)));
    // Esquina doblada: el contorno real queda lejos de la esquina que forman los lados rectos.
    result.folded = corners.some(([x, y], i) =>
      x > width * 0.01 && x < width * 0.99 && y > height * 0.01 && y < height * 0.99 &&
      distance([x, y], rough[i]) > diagonal * 0.035);
    return result;
  }

  // Mete las esquinas una fracción mínima hacia dentro para que no entren rendijas del fondo al enderezar.
  function inset(points) {
    if (!points) return null;
    const cx = points.reduce((sum, [x]) => sum + x, 0) / 4;
    const cy = points.reduce((sum, [, y]) => sum + y, 0) / 4;
    const result = points.map(([x, y]) => [x + (cx - x) * 0.006, y + (cy - y) * 0.006]);
    result.folded = points.folded;
    return result;
  }

  function detect(source) {
    const small = reduce(source, 320);
    if (!small) return null;
    const { luma, paper, width, height } = small;
    const lines = findLines(luma, width, height, STRICT);
    const sheet = findSheet(small);
    if (lines) {
      // Si ambos métodos coinciden, se conservan las rectas y se toma de la hoja el aviso de esquina doblada.
      if (sheet?.folded && sheet.every(([x, y], i) => Math.hypot((x - lines[i][0]) * width, (y - lines[i][1]) * height)
        < Math.hypot(width, height) * 0.05)) lines.folded = true;
      return inset(lines);
    }
    return inset(sheet || findLines(paper, width, height, LOOSE));
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

  // Nivel de papel por zonas finas (percentil alto de brillo): sirve para quitar sombras y degradados.
  function localPaper(luma, width, height) {
    const cell = clamp(Math.round(Math.max(width, height) / 40), 12, 96);
    const gx = Math.max(2, Math.ceil(width / cell));
    const gy = Math.max(2, Math.ceil(height / cell));
    const levels = new Float32Array(gx * gy);
    const bins = new Uint32Array(64);
    for (let row = 0; row < gy; row++) {
      const top = Math.floor(row * height / gy);
      const bottom = Math.floor((row + 1) * height / gy);
      const stepY = Math.max(1, Math.floor((bottom - top) / 16));
      for (let column = 0; column < gx; column++) {
        const left = Math.floor(column * width / gx);
        const right = Math.floor((column + 1) * width / gx);
        const stepX = Math.max(1, Math.floor((right - left) / 16));
        bins.fill(0);
        let count = 0;
        for (let y = top; y < bottom; y += stepY) {
          for (let x = left; x < right; x += stepX) {
            bins[luma[y * width + x] >> 2]++;
            count++;
          }
        }
        let tone = 63;
        let bright = bins[tone];
        while (tone > 0 && bright < count * 0.22) bright += bins[--tone];
        levels[row * gx + column] = tone * 4 + 3;
      }
    }
    // Una zona llena de tinta o de foto no debe oscurecer el fondo: se acota con el papel del resto.
    const ordered = Array.from(levels).sort((a, b) => a - b);
    const floor = ordered[Math.floor(ordered.length * 0.7)] * 0.55;
    for (let i = 0; i < levels.length; i++) levels[i] = Math.max(levels[i], floor);
    return { levels, gx, gy };
  }

  // Filtro "Documento B/N": papel blanco puro y texto negro, con bordes suaves.
  function documentPass(data, width, height, brightness, contrast) {
    const luma = new Uint8Array(width * height);
    for (let i = 0; i < luma.length; i++) luma[i] = luminance(data, i * 4);
    const { levels, gx, gy } = localPaper(luma, width, height);
    const centre = 0.70 - brightness * 0.003;
    const half = 0.15 / (1 + contrast / 100);
    const low = centre - half;
    for (let y = 0, p = 0; y < height; y++) {
      const row = clamp((y + 0.5) * gy / height - 0.5, 0, gy - 1);
      const top = Math.floor(row);
      const bottom = Math.min(top + 1, gy - 1);
      for (let x = 0; x < width; x++, p++) {
        const column = clamp((x + 0.5) * gx / width - 0.5, 0, gx - 1);
        const left = Math.floor(column);
        const right = Math.min(left + 1, gx - 1);
        const upper = mix(levels[top * gx + left], levels[top * gx + right], column - left);
        const lower = mix(levels[bottom * gx + left], levels[bottom * gx + right], column - left);
        const paper = mix(upper, lower, row - top);
        const t = clamp((luma[p] / paper - low) / (half * 2), 0, 1);
        const value = t * t * (3 - 2 * t) * 255;
        const offset = p * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = value;
      }
    }
  }

  // Con letra latina hay más trazos que suben (b, d, f, h, k, l, t, mayúsculas, puntos) que trazos que
  // bajan (g, j, p, q, y). Se compara la tinta que queda justo encima de las bandas densas de cada línea
  // con la que queda justo debajo: si predomina la de abajo, el texto está al revés.
  function lineBalance(profile) {
    const n = profile.length;
    let peak = 0;
    for (let i = 0; i < n; i++) if (profile[i] > peak) peak = profile[i];
    if (!peak) return null;
    const dense = new Uint8Array(n);
    let lines = 0, previous = false, run = 0;
    for (let y = 0; y < n; y++) {
      let local = 0;
      for (let k = Math.max(0, y - 40); k <= Math.min(n - 1, y + 40); k++) if (profile[k] > local) local = profile[k];
      dense[y] = local > peak * 0.05 && profile[y] >= local * 0.45 ? 1 : 0;
      if (dense[y]) run++;
      if (previous && !dense[y] && run >= 3) lines++;
      if (!dense[y]) run = 0;
      previous = !!dense[y];
    }
    const above = new Int32Array(n), below = new Int32Array(n);
    let last = -1e6;
    for (let y = 0; y < n; y++) { if (dense[y]) last = y; above[y] = y - last; }
    last = 1e6;
    for (let y = n - 1; y >= 0; y--) { if (dense[y]) last = y; below[y] = last - y; }
    const reach = Math.max(8, Math.round(n / 60));
    const noise = Math.max(2, peak * 0.003);
    let rise = 0, fall = 0;
    for (let y = 0; y < n; y++) {
      if (dense[y] || profile[y] < noise) continue;
      if (below[y] < above[y] && below[y] <= reach) rise += profile[y];
      else if (above[y] < below[y] && above[y] <= reach) fall += profile[y];
    }
    return lines >= 4 && rise + fall > 0 ? (rise - fall) / (rise + fall) : null;
  }

  // Perfil de tinta con las líneas inclinadas una pendiente dada. La pendiente que deja los picos más agudos
  // es la inclinación del texto.
  function bestTilt(xs, ys, width, height, vertical) {
    const length = vertical ? width : height;
    const across = vertical ? height : width;
    const pad = Math.ceil(across * 0.06) + 2;
    const count = xs.length;
    const cx = width / 2, cy = height / 2;
    let profile = new Float32Array(length + pad * 2);
    const measure = (slope, target) => {
      target.fill(0);
      for (let i = 0; i < count; i++) {
        // Cada píxel se reparte entre las dos filas más cercanas para no perder los trazos finos.
        const position = (vertical ? xs[i] - (ys[i] - cy) * slope : ys[i] - (xs[i] - cx) * slope) + pad;
        const whole = Math.floor(position);
        const part = position - whole;
        target[whole] += 1 - part;
        target[whole + 1] += part;
      }
      let squares = 0;
      for (let i = 0; i < target.length; i++) squares += target[i] * target[i];
      return squares * length / (count * count);
    };
    let best = { slope: 0, sharp: measure(0, profile) };
    const flat = best.sharp;
    const trial = new Float32Array(profile.length);
    const search = (from, to, step) => {
      for (let slope = from; slope <= to + 1e-9; slope += step) {
        const sharp = measure(slope, trial);
        if (sharp > best.sharp) { best = { slope, sharp }; profile = Float32Array.from(trial); }
      }
    };
    search(-0.105, 0.105, 0.004);
    search(best.slope - 0.004, best.slope + 0.004, 0.0005);
    search(best.slope - 0.0006, best.slope + 0.0006, 0.0002);
    return { ...best, flat, profile };
  }

  // Cuántos giros de 90° (horario) hacen falta para que el texto quede derecho, y cuánto hay que girar
  // (en radianes, horario) para nivelar las líneas. Solo decide cuando está seguro; si no, no toca nada.
  function orientation(source) {
    const none = { rotation: 0, skew: 0, confident: false };
    const small = reduce(source, 1600);
    if (!small) return none;
    const { luma, width, height } = small;
    const { levels, gx, gy } = localPaper(luma, width, height);
    const xs = [], ys = [];
    for (let y = 0; y < height; y++) {
      const cellRow = Math.min(gy - 1, Math.floor(y * gy / height));
      for (let x = 0; x < width; x++) {
        const paper = levels[cellRow * gx + Math.min(gx - 1, Math.floor(x * gx / width))];
        const value = luma[y * width + x];
        if (value < paper * 0.68 && paper - value > 28) { xs.push(x); ys.push(y); }
      }
    }
    const share = xs.length / (width * height);
    if (share < 0.004 || share > 0.35) return none;

    // Las líneas de texto dejan huecos alineados en su dirección, no en la perpendicular.
    const across = bestTilt(xs, ys, width, height, false);
    const down = bestTilt(xs, ys, width, height, true);
    const horizontal = across.sharp >= down.sharp;
    const main = horizontal ? across : down, other = horizontal ? down : across;
    if (main.sharp - 1 < 0.25 || (main.sharp - 1) / (other.sharp - 1 + 1e-6) < 1.6) return none;

    const balance = lineBalance(main.profile);
    // Voltear 180° una página que ya estaba bien es lo peor que puede pasar, así que ahí se exige más evidencia.
    // Una página de lado ya sabemos que hay que girarla: basta una pista para elegir el sentido.
    if (horizontal) {
      const upsideDown = balance !== null && balance <= -0.15;
      return { rotation: upsideDown ? 2 : 0, skew: levelling(main, true), confident: upsideDown };
    }
    if (balance === null || Math.abs(balance) < 0.06) return none;
    return { rotation: balance > 0 ? 1 : 3, skew: levelling(main, false), confident: true };
  }

  function levelling(main, horizontal) {
    const angle = Math.atan(main.slope);
    if (Math.abs(main.slope) >= 0.1 || Math.abs(angle) < 0.003 || main.sharp < main.flat * 1.02) return 0;
    return horizontal ? -angle : angle;
  }

  function enhance(source, target, { mode, brightness, contrast, rotation, skew = 0 }) {
    const turned = rotation % 2 !== 0;
    target.width = turned ? source.height : source.width;
    target.height = turned ? source.width : source.height;
    const context = target.getContext("2d", { willReadFrequently: true });
    context.save();
    if (skew) {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, target.width, target.height);
    }
    context.translate(target.width / 2, target.height / 2);
    context.rotate(rotation * Math.PI / 2 + skew);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    context.restore();
    if (mode === "color" && brightness === 0 && contrast === 0) return;

    const { width, height } = target;
    const pixels = context.getImageData(0, 0, width, height);
    const { data } = pixels;
    if (mode === "bw") {
      documentPass(data, width, height, brightness, contrast);
      context.putImageData(pixels, 0, 0);
      return;
    }
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

  return { canvas, clamp, detect, enhance, fullFrame, imageSize, isQuad, orientation, read, rectify };
})();
