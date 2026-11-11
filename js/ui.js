/**
 * ui.js — Capa de interfaz compartida:
 *  - Animaciones con Motion (motion.dev), respetando prefers-reduced-motion
 *  - Iconos Lucide (hidratación de <i data-icon="…">)
 *  - Rebote elástico al pulsar y brillo al pasar el cursor
 *  - Indicadores deslizantes para pestañas, segmentados y menú
 *  - Diálogos de confirmación / texto (sustituyen a confirm() y prompt())
 * No contiene lógica de datos.
 */
const UI = (() => {
  const M = window.Motion || null;
  const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const hoverMq = window.matchMedia("(hover: hover) and (pointer: fine)");

  function reduced() {
    return reduceMq.matches;
  }

  // ------------------------------------------------------------------
  // Animación
  // ------------------------------------------------------------------
  function lastOf(v) {
    return Array.isArray(v) ? v[v.length - 1] : v;
  }

  /** Aplica el estado final sin animar (movimiento reducido o sin Motion). */
  function applyFinal(el, keyframes) {
    const final = {};
    Object.keys(keyframes).forEach((k) => (final[k] = lastOf(keyframes[k])));
    if (M) {
      return M.animate(el, final, { duration: 0 });
    }
    const t = [];
    Object.keys(final).forEach((k) => {
      const v = final[k];
      const px = typeof v === "number" ? v + "px" : v;
      if (k === "x") t.push(`translateX(${px})`);
      else if (k === "y") t.push(`translateY(${px})`);
      else if (k === "scale") t.push(`scale(${v})`);
      else if (k.startsWith("--")) el.style.setProperty(k, v);
      else if (k === "width" || k === "height") el.style[k] = px;
      else el.style[k] = v;
    });
    if (t.length) el.style.transform = t.join(" ");
    return Promise.resolve();
  }

  /**
   * Envoltorio de Motion.animate. Con movimiento reducido solo se conservan
   * los fundidos de opacidad (cortos); todo desplazamiento/escala es inmediato.
   */
  function animate(el, keyframes, options = {}) {
    if (!el) return Promise.resolve();
    if (!M) return applyFinal(el, keyframes);
    if (reduced()) {
      const onlyOpacity = Object.keys(keyframes).every((k) => k === "opacity");
      if (!onlyOpacity) return applyFinal(el, keyframes);
      return M.animate(el, keyframes, { duration: 0.15, ease: "linear" });
    }
    return M.animate(el, keyframes, options);
  }

  const SPRING_SOFT = { type: "spring", stiffness: 380, damping: 32 };
  const SPRING_SHEET = { type: "spring", stiffness: 420, damping: 38 };
  const SPRING_JELLY = { type: "spring", stiffness: 520, damping: 11, mass: 0.8 };

  // ------------------------------------------------------------------
  // Iconos (Lucide)
  // ------------------------------------------------------------------
  function icon(name, extraClass = "") {
    const body = (typeof LUCIDE_ICONS !== "undefined" && LUCIDE_ICONS[name]) || "";
    return (
      `<svg class="icon icon-${name}${extraClass ? " " + extraClass : ""}" viewBox="0 0 24 24" ` +
      `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
    );
  }

  function hydrateIcons(root = document) {
    root.querySelectorAll("i[data-icon]").forEach((el) => {
      const tpl = document.createElement("template");
      tpl.innerHTML = icon(el.dataset.icon, el.className);
      el.replaceWith(tpl.content.firstChild);
    });
  }

  // ------------------------------------------------------------------
  // Rebote elástico al pulsar + brillo al pasar el cursor (delegados)
  // ------------------------------------------------------------------
  const PRESSABLE = "button, .pressable";

  function pressScale(el) {
    if (el.classList.contains("home-card") || el.classList.contains("settings-row")) return 0.97;
    if (el.classList.contains("btn") || el.classList.contains("sheet-action")) return 0.95;
    return 0.9;
  }

  function initPress() {
    let pressed = null;
    const release = () => {
      if (!pressed) return;
      const el = pressed;
      pressed = null;
      animate(el, { scale: 1 }, SPRING_JELLY);
    };
    document.addEventListener(
      "pointerdown",
      (e) => {
        const el = e.target.closest && e.target.closest(PRESSABLE);
        if (!el || el.disabled || el.classList.contains("no-press")) return;
        pressed = el;
        animate(el, { scale: pressScale(el) }, { duration: 0.12, ease: "easeOut" });
      },
      { passive: true }
    );
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });
    window.addEventListener("blur", release);
  }

  function initShine() {
    let last = null;
    document.addEventListener("mouseover", (e) => {
      if (!hoverMq.matches || reduced()) return;
      const el = e.target.closest && e.target.closest(".shine");
      if (el === last) return;
      last = el;
      if (!el || el.disabled) return;
      animate(el, { "--shine-x": ["-140%", "140%"] }, { duration: 0.75, ease: "easeOut" });
    });
  }

  // ------------------------------------------------------------------
  // Indicadores deslizantes (pestañas, segmentados, menú)
  // ------------------------------------------------------------------
  const sliders = [];

  /**
   * @param {HTMLElement} container contenedor con position:relative
   * @param {string} activeSelector selector del elemento activo dentro del contenedor
   */
  function registerSlider(container, activeSelector) {
    if (!container) return;
    const ind = document.createElement("span");
    ind.className = "slide-indicator";
    ind.setAttribute("aria-hidden", "true");
    container.prepend(ind);
    sliders.push({ container, activeSelector, ind, placed: false });
  }

  function syncSlider(s, instant) {
    const active = s.container.querySelector(s.activeSelector);
    // Contenedor oculto (display:none) o sin opción activa: no se mide.
    if (!active || s.container.offsetWidth === 0 || active.offsetWidth === 0) {
      if (!active) s.ind.style.opacity = "0";
      return;
    }
    const target = {
      x: active.offsetLeft,
      y: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    };
    s.ind.style.opacity = "1";
    if (!s.placed || instant) {
      applyFinal(s.ind, target);
      s.placed = true;
    } else {
      animate(s.ind, target, SPRING_SOFT);
    }
  }

  function syncSliders(instant = false) {
    sliders.forEach((s) => syncSlider(s, instant));
  }

  // ------------------------------------------------------------------
  // Transiciones de vista y de paneles
  // ------------------------------------------------------------------
  function enterView(screenEl) {
    if (!screenEl) return;
    animate(screenEl, { opacity: [0, 1] }, { duration: 0.28, ease: "easeOut" });
    const items = screenEl.querySelectorAll("[data-enter]");
    if (!items.length) return;
    if (!M || reduced()) return;
    M.animate(
      items,
      { opacity: [0, 1], y: [14, 0] },
      { delay: M.stagger(0.045, { startDelay: 0.03 }), type: "spring", stiffness: 300, damping: 30 }
    );
  }

  function enterItems(elements) {
    if (!M || reduced() || !elements || !elements.length) return;
    M.animate(
      elements,
      { opacity: [0, 1], y: [8, 0] },
      { delay: M.stagger(0.03), duration: 0.3, ease: "easeOut" }
    );
  }

  // ------------------------------------------------------------------
  // Capas modales: overlay + hoja/diálogo
  // ------------------------------------------------------------------
  function showOverlay(el) {
    el.classList.add("show");
    animate(el, { opacity: [0, 1] }, { duration: 0.2, ease: "linear" });
  }
  function hideOverlay(el) {
    if (!el.classList.contains("show")) return;
    Promise.resolve(animate(el, { opacity: 0 }, { duration: 0.18, ease: "linear" })).then(() => {
      el.classList.remove("show");
    });
  }

  function openSheet(el) {
    el.classList.add("show");
    el.dataset.state = "open";
    const dist = el.offsetHeight + 48;
    animate(el, { y: [dist, 0], opacity: [0.6, 1] }, SPRING_SHEET);
    enterItems(el.querySelectorAll(".sheet-action, .picker-sig-item"));
  }
  function closeSheet(el) {
    if (!el.classList.contains("show")) return;
    el.dataset.state = "closed";
    const dist = el.offsetHeight + 48;
    Promise.resolve(animate(el, { y: dist, opacity: 0.6 }, { duration: 0.22, ease: "easeIn" })).then(() => {
      // Si se volvió a abrir mientras se cerraba, no la ocultamos.
      if (el.dataset.state === "closed") el.classList.remove("show");
    });
  }

  function focusables(root) {
    return Array.from(
      root.querySelectorAll('button:not([disabled]), input:not([hidden]), [href], [tabindex]:not([tabindex="-1"])')
    ).filter((n) => n.offsetParent !== null);
  }

  /** Mantiene el foco del teclado dentro de `root` mientras esté abierto. */
  function trapFocus(root, e) {
    if (e.key !== "Tab") return;
    const list = focusables(root);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ------------------------------------------------------------------
  // Diálogos (confirmar / pedir texto)
  // ------------------------------------------------------------------
  let dialogEls = null;
  let dialogResolve = null;
  let dialogKind = "confirm";
  let dialogReturnFocus = null;

  function buildDialog() {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog glass" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
        <div class="dialog-icon" id="dialog-icon"></div>
        <h2 class="dialog-title" id="dialog-title"></h2>
        <p class="dialog-message" id="dialog-message"></p>
        <label class="field dialog-field" id="dialog-field" hidden>
          <span class="field-label" id="dialog-input-label"></span>
          <input type="text" class="text-input" id="dialog-input" autocomplete="off" />
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn secondary" id="dialog-cancel">Cancelar</button>
          <button type="button" class="btn primary shine" id="dialog-ok">Aceptar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const q = (id) => overlay.querySelector("#" + id);
    dialogEls = {
      overlay,
      box: overlay.querySelector(".dialog"),
      icon: q("dialog-icon"),
      title: q("dialog-title"),
      message: q("dialog-message"),
      field: q("dialog-field"),
      inputLabel: q("dialog-input-label"),
      input: q("dialog-input"),
      cancel: q("dialog-cancel"),
      ok: q("dialog-ok"),
    };
    dialogEls.cancel.addEventListener("click", () => settleDialog(false));
    dialogEls.ok.addEventListener("click", () => settleDialog(true));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) settleDialog(false);
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settleDialog(false);
      } else if (e.key === "Enter" && e.target === dialogEls.input) {
        e.preventDefault();
        settleDialog(true);
      } else {
        trapFocus(dialogEls.box, e);
      }
    });
  }

  function settleDialog(accepted) {
    if (!dialogResolve) return;
    const resolve = dialogResolve;
    dialogResolve = null;
    const value = dialogKind === "prompt" ? (accepted ? dialogEls.input.value : null) : accepted;
    const { overlay, box } = dialogEls;
    animate(box, { scale: 0.96, opacity: 0 }, { duration: 0.15, ease: "easeIn" });
    Promise.resolve(animate(overlay, { opacity: 0 }, { duration: 0.18, ease: "linear" })).then(() => {
      if (!dialogResolve) overlay.classList.remove("show");
    });
    if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
    dialogReturnFocus = null;
    resolve(value);
  }

  function openDialog(kind, opts) {
    if (!dialogEls) buildDialog();
    // Si ya había un diálogo abierto, se cancela antes de mostrar el nuevo.
    if (dialogResolve) settleDialog(false);
    dialogKind = kind;
    dialogReturnFocus = document.activeElement;
    const d = dialogEls;
    d.icon.innerHTML = icon(opts.icon || (opts.danger ? "circle-alert" : "info"));
    d.icon.classList.toggle("danger", !!opts.danger);
    d.title.textContent = opts.title || "";
    d.message.textContent = opts.message || "";
    d.message.hidden = !opts.message;
    d.ok.textContent = opts.confirmText || "Aceptar";
    d.cancel.textContent = opts.cancelText || "Cancelar";
    d.ok.classList.toggle("danger", !!opts.danger);
    d.ok.classList.toggle("primary", !opts.danger);
    d.field.hidden = kind !== "prompt";
    if (kind === "prompt") {
      d.inputLabel.textContent = opts.label || "";
      d.input.value = opts.value || "";
      d.input.placeholder = opts.placeholder || "";
    }
    d.overlay.classList.add("show");
    animate(d.overlay, { opacity: [0, 1] }, { duration: 0.18, ease: "linear" });
    animate(d.box, { opacity: [0, 1], scale: [0.92, 1], y: [12, 0] }, { type: "spring", stiffness: 420, damping: 30 });
    if (kind === "prompt") {
      d.input.focus();
      d.input.select();
    } else {
      // En acciones destructivas el foco inicial va a "Cancelar".
      (opts.danger ? d.cancel : d.ok).focus();
    }
    return new Promise((resolve) => {
      dialogResolve = resolve;
    });
  }

  const Dialog = {
    /** @returns {Promise<boolean>} */
    confirm: (opts) => openDialog("confirm", opts),
    /** @returns {Promise<string|null>} texto introducido o null si se cancela */
    prompt: (opts) => openDialog("prompt", opts),
  };

  // ------------------------------------------------------------------
  function init() {
    hydrateIcons();
    initPress();
    initShine();
    let raf = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => syncSliders(true));
    });
  }

  return {
    init,
    animate,
    reduced,
    icon,
    hydrateIcons,
    registerSlider,
    syncSliders,
    enterView,
    enterItems,
    showOverlay,
    hideOverlay,
    openSheet,
    closeSheet,
    trapFocus,
    Dialog,
  };
})();
