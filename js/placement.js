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
    let livePageNum = pageNum; // puede cambiar si el usuario arrastra la firma a otra página
    let dragStartRect = null; // rect (viewport) del elemento al iniciar el arrastre

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

      if (m === "move") {
        // Sacamos la firma de su página (que la recorta/tapa visualmente
        // en los bordes) y la anclamos al viewport mientras se arrastra,
        // para que pueda pasar libremente por encima de cualquier página.
        dragStartRect = el.getBoundingClientRect();
        el.style.position = "fixed";
        el.style.left = dragStartRect.left + "px";
        el.style.top = dragStartRect.top + "px";
        el.style.width = dragStartRect.width + "px";
        el.style.height = dragStartRect.height + "px";
        el.style.zIndex = "500";
        document.body.appendChild(el);
        showTrash();
      }

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

      if (mode === "move") {
        el.style.left = dragStartRect.left + dx + "px";
        el.style.top = dragStartRect.top + dy + "px";
        updateTrashArmedState(el);
      } else if (mode === "resize") {
        const pageW = pageRect.width;
        const newWRel = Math.max(0.04, startItem.wRel + dx / pageW);
        const aspect = startItem.hRel / startItem.wRel;
        item.wRel = newWRel;
        item.hRel = Math.max(0.03, newWRel * aspect);
        applyItemStyle(wrapEl, el, item);
      } else if (mode === "rotate") {
        const pageW = pageRect.width;
        const pageH = pageRect.height;
        const cx = pageRect.left + (startItem.xRel + startItem.wRel / 2) * pageW;
        const cy = pageRect.top + (startItem.yRel + startItem.hRel / 2) * pageH;
        const angle = (Math.atan2(pos.y - cy, pos.x - cx) * 180) / Math.PI;
        item.rotation = Math.round(angle + 90);
        applyItemStyle(wrapEl, el, item);
      }
    }

    function onUp() {
      if (mode === "move") {
        finishMove();
      } else if (mode) {
        pushHistory();
      }
      mode = null;
      editingActive = false;
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    function finishMove() {
      hideTrash();

      if (isOverTrash(el)) {
        placements[livePageNum] = (placements[livePageNum] || []).filter((i) => i.id !== item.id);
        el.remove();
        pushHistory();
        Toast.show("Firma eliminada del documento");
        return;
      }

      const elRect = el.getBoundingClientRect();
      const cy = elRect.top + elRect.height / 2;
      el.classList.remove("over-trash");

      // ¿Sobre qué página quedó el centro de la firma? Si no cae dentro de
      // ninguna, se queda en la página donde estaba.
      const allWraps = PdfViewer.getAllPageWraps();
      let targetWrap = allWraps.find((w) => {
        const r = w.wrapEl.getBoundingClientRect();
        return cy >= r.top && cy <= r.bottom;
      });
      if (!targetWrap) {
        targetWrap = allWraps.find((w) => w.pageNum === livePageNum) || allWraps[0];
      }

      const newPageRect = targetWrap.wrapEl.getBoundingClientRect();
      item.xRel = clamp01((elRect.left - newPageRect.left) / newPageRect.width);
      item.yRel = clamp01((elRect.top - newPageRect.top) / newPageRect.height);
      item.wRel = elRect.width / newPageRect.width;
      item.hRel = elRect.height / newPageRect.height;

      if (targetWrap.pageNum !== livePageNum) {
        placements[livePageNum] = (placements[livePageNum] || []).filter((i) => i.id !== item.id);
        if (!placements[targetWrap.pageNum]) placements[targetWrap.pageNum] = [];
        placements[targetWrap.pageNum].push(item);
        livePageNum = targetWrap.pageNum;
        el.dataset.page = livePageNum;
        Toast.show(`Firma movida a la página ${livePageNum}`);
      }

      wrapEl = targetWrap.wrapEl;
      pageRect = newPageRect;

      // Devolvemos la firma a su posicionamiento normal (relativo a su
      // página), ahora ya dentro de la página correcta.
      el.style.position = "";
      el.style.zIndex = "";
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.height = "";
      wrapEl.appendChild(el);
      applyItemStyle(wrapEl, el, item);
      pushHistory();
    }

    el.addEventListener("touchstart", (e) => {
      // Si el toque empezó sobre un botón (borrar, duplicar, rotar,
      // redimensionar), NO iniciamos el arrastre del contenedor: dejamos
      // que ese botón reciba el toque, si no, su "click" nunca llegaba a
      // dispararse (por eso "borrar" fallaba a veces).
      if (e.target.closest(".sig-handle")) return;
      if (e.touches.length === 1) onDown(e, "move");
    }, { passive: false });
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest(".sig-handle")) return;
      onDown(e, "move");
    });

    const resizeHandle = el.querySelector(".handle-resize");
    resizeHandle.addEventListener("touchstart", (e) => onDown(e, "resize"), { passive: false });
    resizeHandle.addEventListener("mousedown", (e) => onDown(e, "resize"));

    const rotateHandle = el.querySelector(".handle-rotate");
    rotateHandle.addEventListener("touchstart", (e) => onDown(e, "rotate"), { passive: false });
    rotateHandle.addEventListener("mousedown", (e) => onDown(e, "rotate"));

    const deleteHandle = el.querySelector(".handle-delete");
    deleteHandle.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteItem(livePageNum, item.id);
    });
    // Refuerzo: además del click, atendemos el toque directamente (más
    // fiable en móvil que depender solo del evento "click" sintético).
    deleteHandle.addEventListener("touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteItem(livePageNum, item.id);
    }, { passive: false });

    const duplicateHandle = el.querySelector(".handle-duplicate");
    duplicateHandle.addEventListener("click", (e) => {
      e.stopPropagation();
      duplicateItem(livePageNum, item.id);
    });
    duplicateHandle.addEventListener("touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      duplicateItem(livePageNum, item.id);
    }, { passive: false });
  }

  function clamp01(v) {
    return Math.max(-0.15, Math.min(1.1, v));
  }

  // ------------------------- ZAFACÓN (eliminar arrastrando) -------------------------
  function getTrashEl() {
    return document.getElementById("trash-dropzone");
  }

  function showTrash() {
    const trash = getTrashEl();
    if (trash) trash.classList.add("visible");
  }

  function hideTrash() {
    const trash = getTrashEl();
    if (trash) {
      trash.classList.remove("visible", "armed");
    }
  }

  function isOverTrash(el) {
    const trash = getTrashEl();
    if (!trash) return false;
    const elRect = el.getBoundingClientRect();
    const ex = elRect.left + elRect.width / 2;
    const ey = elRect.top + elRect.height / 2;
    const tRect = trash.getBoundingClientRect();
    // Un poco más generoso que el tamaño visual del botón, para que sea
    // fácil acertar el gesto en pantallas pequeñas.
    const margin = 18;
    return (
      ex >= tRect.left - margin &&
      ex <= tRect.right + margin &&
      ey >= tRect.top - margin &&
      ey <= tRect.bottom + margin
    );
  }

  function updateTrashArmedState(el) {
    const trash = getTrashEl();
    if (!trash) return;
    const over = isOverTrash(el);
    trash.classList.toggle("armed", over);
    el.classList.toggle("over-trash", over);
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
