/**
 * drawSignature.js — Panel para dibujar una firma con el dedo/mouse
 * sobre un <canvas>. Exporta el resultado como PNG con fondo transparente.
 */
const DrawSignature = (() => {
  let canvas, ctx;
  let drawing = false;
  let hasStroke = false;
  let last = { x: 0, y: 0 };
  let strokeColor = "#0b0c10";

  function resizeCanvasToDisplaySize() {
    const wrap = canvas.parentElement;
    const ratio = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    // Preserve existing drawing on resize
    const prev = document.createElement("canvas");
    prev.width = canvas.width;
    prev.height = canvas.height;
    prev.getContext("2d").drawImage(canvas, 0, 0);

    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = strokeColor;
    if (prev.width > 0) {
      ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, w, h);
    }
  }

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  function start(evt) {
    evt.preventDefault();
    drawing = true;
    last = getPos(evt);
  }

  function move(evt) {
    if (!drawing) return;
    evt.preventDefault();
    const pos = getPos(evt);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    last = pos;
    hasStroke = true;
  }

  function end(evt) {
    if (evt) evt.preventDefault();
    drawing = false;
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke = false;
  }

  function isEmpty() {
    return !hasStroke;
  }

  /**
   * Devuelve {dataUrl, width, height} recortando el área con contenido
   * para que la firma quede ajustada, con fondo transparente.
   */
  function exportPng() {
    // Buscar bounding box del contenido dibujado
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;

    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const alpha = imgData[(y * w + x) * 4 + 3];
        if (alpha > 10) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return null;

    const pad = 14;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w, maxX + pad);
    maxY = Math.min(h, maxY + pad);

    const cropW = maxX - minX;
    const cropH = maxY - minY;
    const out = document.createElement("canvas");
    out.width = cropW;
    out.height = cropH;
    out.getContext("2d").drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    return { dataUrl: out.toDataURL("image/png"), width: cropW, height: cropH };
  }

  function setColor(color) {
    strokeColor = color;
    ctx.strokeStyle = color;
  }

  function init() {
    canvas = document.getElementById("draw-canvas");
    ctx = canvas.getContext("2d");
    resizeCanvasToDisplaySize();
    window.addEventListener("resize", resizeCanvasToDisplaySize);

    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end, { passive: false });
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);

    document.getElementById("btn-clear-draw").addEventListener("click", clear);
    document.getElementById("draw-color").addEventListener("input", (e) => setColor(e.target.value));
  }

  return { init, clear, isEmpty, exportPng, resizeCanvasToDisplaySize };
})();
