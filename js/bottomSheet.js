/**
 * bottomSheet.js — Controla el botón "Más acciones" del visor y las hojas
 * inferiores (menú de acciones del documento y selector de firmas).
 */
const BottomSheet = (() => {
  const sheet = () => document.getElementById("bottom-sheet");
  const overlay = () => document.getElementById("sheet-overlay");
  let returnFocus = null;

  function isOpen() {
    return sheet().dataset.state === "open";
  }

  function open() {
    returnFocus = document.activeElement;
    UI.showOverlay(overlay());
    UI.openSheet(sheet());
    const first = sheet().querySelector(".sheet-action");
    if (first) first.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen()) return;
    UI.closeSheet(sheet());
    UI.hideOverlay(overlay());
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function init() {
    document.getElementById("fab-main").addEventListener("click", open);
    document.getElementById("btn-close-sheet").addEventListener("click", close);
    overlay().addEventListener("click", close);
    sheet().addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      else UI.trapFocus(sheet(), e);
    });
  }

  return { init, open, close };
})();

const SignaturePickerSheet = (() => {
  const sheet = () => document.getElementById("signature-picker-sheet");
  const overlay = () => document.getElementById("sheet-overlay-2");
  let resolver = null;
  let returnFocus = null;

  function close() {
    UI.closeSheet(sheet());
    UI.hideOverlay(overlay());
    resolver = null;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function dismiss() {
    const resolve = resolver; // capturar antes de close(), que pone resolver=null
    close();
    if (resolve) resolve(null);
  }

  /**
   * Muestra el selector de firmas y devuelve una Promise que resuelve
   * con el registro de firma elegido (o null si se cierra sin elegir).
   */
  function open(signaturesList) {
    const listEl = document.getElementById("signature-picker-list");
    listEl.innerHTML = "";
    signaturesList.forEach((sig) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "picker-sig-item";
      item.setAttribute("aria-label", `Insertar firma ${sig.name}`);
      const thumb = document.createElement("span");
      thumb.className = "picker-sig-thumb";
      const img = document.createElement("img");
      img.src = sig.dataUrl;
      img.alt = "";
      thumb.appendChild(img);
      const name = document.createElement("span");
      name.className = "picker-sig-name";
      name.textContent = sig.name;
      item.append(thumb, name);
      item.addEventListener("click", () => {
        const resolve = resolver; // guardar referencia ANTES de close(), que pone resolver=null
        close();
        if (resolve) resolve(sig);
      });
      listEl.appendChild(item);
    });
    returnFocus = document.activeElement;
    UI.showOverlay(overlay());
    UI.openSheet(sheet());
    const first = listEl.querySelector(".picker-sig-item");
    if (first) first.focus({ preventScroll: true });
    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  function init() {
    overlay().addEventListener("click", dismiss);
    document.getElementById("btn-close-picker").addEventListener("click", dismiss);
    sheet().addEventListener("keydown", (e) => {
      if (e.key === "Escape") dismiss();
      else UI.trapFocus(sheet(), e);
    });
  }

  return { init, open, close };
})();
