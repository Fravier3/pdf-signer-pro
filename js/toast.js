/**
 * toast.js — Notificaciones flotantes tipo iOS + overlay de carga
 */
const Toast = (() => {
  let hideTimer = null;
  let visible = false;
  function show(message, duration = 2200) {
    const el = document.getElementById("toast");
    el.textContent = message;
    if (!visible) {
      visible = true;
      UI.animate(el, { opacity: [0, 1], y: [16, 0], scale: [0.96, 1] }, { type: "spring", stiffness: 420, damping: 28 });
    }
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      visible = false;
      UI.animate(el, { opacity: 0, y: 12 }, { duration: 0.22, ease: "easeIn" });
    }, duration);
  }
  return { show };
})();

const Loader = (() => {
  const overlay = () => document.getElementById("loader");
  const textEl = () => document.getElementById("loader-text");
  let spin = null;
  function show(text = "Procesando…") {
    textEl().textContent = text;
    const el = overlay();
    el.hidden = false;
    el.style.display = "flex";
    // Con movimiento reducido el anillo queda estático; el texto informa del estado.
    if (!spin && window.Motion && !UI.reduced()) {
      spin = Motion.animate(
        el.querySelector(".loader-spinner"),
        { rotate: [0, 360] },
        { duration: 0.8, ease: "linear", repeat: Infinity }
      );
    }
  }
  function hide() {
    const el = overlay();
    el.hidden = true;
    el.style.display = "none";
    if (spin) {
      spin.stop();
      spin = null;
    }
  }
  return { show, hide };
})();
