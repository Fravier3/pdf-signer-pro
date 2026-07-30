/**
 * placement.js — Coloca firmas sobre cualquier página del PDF y permite
 * moverlas, escalarlas, rotarlas, duplicarlas y eliminarlas con gestos
 * táctiles. Mantiene un modelo de datos por página con posiciones
 * relativas (0..1) para que la exportación final sea precisa a
 * cualquier resolución.
 */
const PlacementManager = (() => {
  // Estructura: { pageNum: [ {id, sigId, dataUrl, xRel, yRel, wRel, hRel, rotation} ] }
  let placements = {};
  let selectedEl = null;
  let editingActive = false;
  let history = []; // para deshacer

  function uid() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function reset() {
    placements = {};
    selectedEl = null;
    history = [];
    updateUndoButton();
  }

  function isEditingActive() {
    return editingActive;
  }

  /**
   * Inserta una firma en el centro visible de la página indicada.
   */
  function insertSignature(pageNum, sig) {
    try {
      const wrapEl = PdfViewer.getPageWrapEl(pageNum);
      if (!wrapEl) {
        console.error("[PDF Signer Pro] No se encontró la página", pageNum, "para insertar la firma.");
        Toast.show("No se pudo insertar: no se encontró la página del documento");
        return;
      }

      let pageW = wrapEl.offsetWidth;
      let pageH = wrapEl.offsetHeight;
      if (!pageW || !pageH) {
        console.error("[PDF Signer Pro] La página aún no tiene tamaño (offsetWidth/Height = 0).", { pageW, pageH });
        Toast.show("La página todavía se está cargando, intenta de nuevo en un segundo");
        return;
      }
      if (!sig || !sig.dataUrl) {
        console.error("[PDF Signer Pro] La firma seleccionada no tiene imagen válida.", sig);
        Toast.show("Esa firma no se pudo cargar, intenta con otra");
        return;
      }

      const aspect = sig.width / sig.height || 2.4;
      const wRel = 0.32;
      const hRel = (wRel * pageW) / aspect / pageH;

      const item = {
        id: uid(),
        sigId: sig.id,
        dataUrl: sig.dataUrl,
        xRel: 0.5 - wRel / 2,
        yRel: 0.5 - hRel / 2,
        wRel,
        hRel,
        rotation: 0,
      };

      if (!placements[pageNum]) placements[pageNum] = [];
      placements[pageNum].push(item);
      renderPlacement(pageNum, item);
      pushHistory();
      selectElementById(item.id);

      // Desplaza el scroll para que la página sea visible
      wrapEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      console.error("[PDF Signer Pro] Error al insertar la firma:", err);
      Toast.show("Ocurrió un error al insertar la firma");
    }
  }

  function renderPlacement(pageNum, item) {
    const wrapEl = PdfViewer.getPageWrapEl(pageNum);
    if (!wrapEl) return;

    const el = document.createElement("div");
    el.className = "placed-sig";
    el.dataset.id = item.id;
    el.dataset.page = pageNum;
    el.innerHTML = `
      <img src="${item.dataUrl}" draggable="false" alt="firma">
      <div class="sig-handle handle-rotate" title="Rotar"></div>
      <div class="sig-handle handle-delete" title="Eliminar">✕</div>
      <div class="sig-handle handle-duplicate" title="Duplicar">⧉</div>
      <div class="sig-handle handle-resize" title="Redimensionar"></div>
    `;
    wrapEl.appendChild(el);
    applyItemStyle(wrapEl, el, item);
    attachInteractions(wrapEl, el, item, pageNum);
  }

  function applyItemStyle(wrapEl, el, item) {
    const pageW = wrapEl.offsetWidth;
    const pageH = wrapEl.offsetHeight;
    el.style.left = item.xRel * pageW + "px";
    el.style.top = item.yRel * pageH + "px";
    el.style.width = item.wRel * pageW + "px";
    el.style.height = item.hRel * pageH + "px";
    el.style.transform = `rotate(${item.rotation}deg)`;
  }

  function findItem(pageNum, id) {
    const arr = placements[pageNum] || [];
    return arr.find((i) => i.id === id);
  }

  // ------------------------- INTERACCIONES TÁCTILES -------------------------
  function attachInteractions(wrapEl, el, item, pageNum) {
    let mode = null; // 'move' | 'resize' | 'rotate'
    let startPointer = { x: 0, y: 0 };
    let startItem = null;
    let pageRect = null;

    function pointerPos(evt) {
      const t = evt.touches ? evt.touches[0] : evt;
      return { x: t.clientX, y: t.clientY };
    }

    function onDown(evt, m) {
      evt.preventDefault();
      evt.stopPropagation();
      editingActive = true;
      mode = m;
      selectElementById(item.id);
      startPointer = pointerPos(evt);
      startItem = { ...item };
      pageRect = wrapEl.getBoundingClientRect();

      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp, { passive: false });
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }

    function onMove(evt) {
      if (!mode) return;
      evt.preventDefault();
      const pos = pointerPos(evt);
      const dx = pos.x - startPointer.x;
      const dy = pos.y - startPointer.y;
      const pageW = pageRect.width;
      const pageH = pageRect.height;

      if (mode === "move") {
        item.xRel = clamp01(startItem.xRel + dx / pageW);
        item.yRel = clamp01(startItem.yRel + dy / pageH);
      } else if (mode === "resize") {
        const newWRel = Math.max(0.04, startItem.wRel + dx / pageW);
        const aspect = startItem.hRel / startItem.wRel;
        item.wRel = newWRel;
        item.hRel = Math.max(0.03, newWRel * aspect);
      } else if (mode === "rotate") {
        const cx = pageRect.left + (startItem.xRel + startItem.wRel / 2) * pageW;
        const cy = pageRect.top + (startItem.yRel + startItem.hRel / 2) * pageH;
        const angle = (Math.atan2(pos.y - cy, pos.x - cx) * 180) / Math.PI;
        item.rotation = Math.round(angle + 90);
      }
      applyItemStyle(wrapEl, el, item);
    }

    function onUp() {
      mode = null;
      editingActive = false;
      pushHistory();
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    el.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) onDown(e, "move");
    }, { passive: false });
    el.addEventListener("mousedown", (e) => onDown(e, "move"));

    const resizeHandle = el.querySelector(".handle-resize");
    resizeHandle.addEventListener("touchstart", (e) => onDown(e, "resize"), { passive: false });
    resizeHandle.addEventListener("mousedown", (e) => onDown(e, "resize"));

    const rotateHandle = el.querySelector(".handle-rotate");
    rotateHandle.addEventListener("touchstart", (e) => onDown(e, "rotate"), { passive: false });
    rotateHandle.addEventListener("mousedown", (e) => onDown(e, "rotate"));

    el.querySelector(".handle-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteItem(pageNum, item.id);
    });
    el.querySelector(".handle-duplicate").addEventListener("click", (e) => {
      e.stopPropagation();
      duplicateItem(pageNum, item.id);
    });
  }

  function clamp01(v) {
    return Math.max(-0.15, Math.min(1.1, v));
  }

  function selectElementById(id) {
    document.querySelectorAll(".placed-sig.selected").forEach((n) => n.classList.remove("selected"));
    const el = document.querySelector(`.placed-sig[data-id="${id}"]`);
    if (el) {
      el.classList.add("selected");
      selectedEl = el;
    }
  }

  function deselectAll() {
    document.querySelectorAll(".placed-sig.selected").forEach((n) => n.classList.remove("selected"));
    selectedEl = null;
  }

  function deleteItem(pageNum, id) {
    placements[pageNum] = (placements[pageNum] || []).filter((i) => i.id !== id);
    const el = document.querySelector(`.placed-sig[data-id="${id}"]`);
    if (el) el.remove();
    pushHistory();
    Toast.show("Firma eliminada del documento");
  }

  function duplicateItem(pageNum, id) {
    const item = findItem(pageNum, id);
    if (!item) return;
    const clone = { ...item, id: uid(), xRel: item.xRel + 0.04, yRel: item.yRel + 0.04 };
    placements[pageNum].push(clone);
    renderPlacement(pageNum, clone);
    pushHistory();
    selectElementById(clone.id);
  }

  function pushHistory() {
    history.push(JSON.stringify(placements));
    if (history.length > 40) history.shift();
    updateUndoButton();
  }

  function updateUndoButton() {
    const btn = document.getElementById("btn-viewer-undo");
    if (btn) btn.disabled = history.length < 2;
  }

  function undo() {
    if (history.length < 2) return;
    history.pop();
    const prev = JSON.parse(history[history.length - 1]);
    placements = prev;
    redrawAll();
    updateUndoButton();
  }

  function redrawAll() {
    document.querySelectorAll(".placed-sig").forEach((n) => n.remove());
    Object.keys(placements).forEach((pageNum) => {
      placements[pageNum].forEach((item) => renderPlacement(Number(pageNum), item));
    });
  }

  function getPlacements() {
    return placements;
  }

  function hasAnyPlacement() {
    return Object.values(placements).some((arr) => arr.length > 0);
  }

  // Click fuera de una firma para deseleccionar
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".placed-sig")) deselectAll();
  });

  return {
    reset,
    insertSignature,
    getPlacements,
    hasAnyPlacement,
    isEditingActive,
    undo,
  };
})();
