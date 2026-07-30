/**
 * toast.js — Notificaciones flotantes tipo iOS + overlay de carga
 */
const Toast = (() => {
  let hideTimer = null;
  function show(message, duration = 2200) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.remove("show"), duration);
  }
  return { show };
})();

const Loader = (() => {
  const overlay = () => document.getElementById("loader");
  const textEl = () => document.getElementById("loader-text");
  function show(text = "Procesando…") {
    textEl().textContent = text;
    const el = overlay();
    el.hidden = false;
    el.style.display = "flex";
  }
  function hide() {
    const el = overlay();
    el.hidden = true;
    el.style.display = "none";
  }
  return { show, hide };
})();
