/**
 * bottomSheet.js — Controla el botón flotante (+) y las hojas inferiores
 * (menú de acciones del documento y selector de firmas para insertar).
 */
const BottomSheet = (() => {
  const sheet = () => document.getElementById("bottom-sheet");
  const overlay = () => document.getElementById("sheet-overlay");

  function open() {
    sheet().classList.add("show");
    overlay().classList.add("show");
  }
  function close() {
    sheet().classList.remove("show");
    overlay().classList.remove("show");
  }

  function init() {
    document.getElementById("fab-main").addEventListener("click", open);
    overlay().addEventListener("click", close);
  }

  return { init, open, close };
})();

const SignaturePickerSheet = (() => {
  const sheet = () => document.getElementById("signature-picker-sheet");
  const overlay = () => document.getElementById("sheet-overlay-2");
  let resolver = null;

  function close() {
    sheet().classList.remove("show");
    overlay().classList.remove("show");
    resolver = null;
  }

  /**
   * Muestra el selector de firmas y devuelve una Promise que resuelve
   * con el registro de firma elegido (o null si se cierra sin elegir).
   */
  function open(signaturesList) {
    const listEl = document.getElementById("signature-picker-list");
    listEl.innerHTML = "";
    signaturesList.forEach((sig) => {
      const item = document.createElement("div");
      item.className = "picker-sig-item";
      item.innerHTML = `<img src="${sig.dataUrl}" alt="${sig.name}">`;
      item.addEventListener("click", () => {
        const resolve = resolver; // guardar referencia ANTES de close(), que pone resolver=null
        close();
        if (resolve) resolve(sig);
      });
      listEl.appendChild(item);
    });
    sheet().classList.add("show");
    overlay().classList.add("show");
    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  function init() {
    overlay().addEventListener("click", () => {
      const resolve = resolver; // misma corrección: capturar antes de close()
      close();
      if (resolve) resolve(null);
    });
  }

  return { init, open, close };
})();
