/**
 * theme.js — Gestión de modo claro / oscuro / automático
 */
const ThemeManager = (() => {
  const KEY = "pdfsignerpro_theme"; // 'light' | 'dark' | 'auto'
  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  function apply(pref) {
    const effective = pref === "auto" ? (mq.matches ? "dark" : "light") : pref;
    document.documentElement.setAttribute("data-theme", effective);
    document.body.setAttribute("data-theme", effective);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", effective === "dark" ? "#0b0c10" : "#f2f2f7");
    updateSegmentedUI(pref);
  }

  function updateSegmentedUI(pref) {
    document.querySelectorAll("#theme-segmented .segmented-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === pref);
    });
  }

  function get() {
    return localStorage.getItem(KEY) || "auto";
  }

  function set(pref) {
    localStorage.setItem(KEY, pref);
    apply(pref);
  }

  function init() {
    apply(get());
    mq.addEventListener("change", () => {
      if (get() === "auto") apply("auto");
    });
    document.querySelectorAll("#theme-segmented .segmented-btn").forEach((btn) => {
      btn.addEventListener("click", () => set(btn.dataset.theme));
    });
  }

  return { init, get, set };
})();
