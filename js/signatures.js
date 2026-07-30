/**
 * signatures.js — Pantalla "Mis Firmas" e importación de imágenes PNG.
 * Todas las firmas se guardan en IndexedDB (ver db.js) y persisten
 * aunque se cierre el navegador.
 */
const SignaturesUI = (() => {
  let cache = [];

  async function refresh() {
    cache = await SignatureDB.getAll();
    render();
    return cache;
  }

  function render() {
    const listEl = document.getElementById("signatures-list");
    const emptyEl = document.getElementById("signatures-empty");
    listEl.innerHTML = "";

    if (cache.length === 0) {
      emptyEl.style.display = "flex";
      listEl.style.display = "none";
      return;
    }
    emptyEl.style.display = "none";
    listEl.style.display = "flex";

    cache.forEach((sig) => {
      const item = document.createElement("div");
      item.className = "signature-item";
      const date = new Date(sig.createdAt).toLocaleDateString();
      item.innerHTML = `
        <div class="signature-thumb"><img src="${sig.dataUrl}" alt="${sig.name}"></div>
        <div class="signature-meta">
          <div class="signature-name">${escapeHtml(sig.name)}</div>
          <div class="signature-date">${date}</div>
        </div>
        <div class="signature-actions">
          <button class="icon-btn btn-rename" aria-label="Renombrar">
            <svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-btn btn-delete" aria-label="Eliminar">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>`;
      item.querySelector(".btn-rename").addEventListener("click", () => renamePrompt(sig));
      item.querySelector(".btn-delete").addEventListener("click", () => deleteConfirm(sig));
      listEl.appendChild(item);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function renamePrompt(sig) {
    const name = window.prompt("Nuevo nombre para la firma:", sig.name);
    if (!name || !name.trim()) return;
    await SignatureDB.rename(sig.id, name.trim());
    await refresh();
    Toast.show("Firma renombrada");
  }

  async function deleteConfirm(sig) {
    const ok = window.confirm(`¿Eliminar la firma "${sig.name}"? Esta acción no se puede deshacer.`);
    if (!ok) return;
    await SignatureDB.remove(sig.id);
    await refresh();
    Toast.show("Firma eliminada");
  }

  async function getAllCached() {
    if (cache.length === 0) await refresh();
    return cache;
  }

  return { refresh, getAllCached };
})();

/**
 * Carga un archivo PNG (File) y devuelve {dataUrl, width, height}.
 */
function readPngFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.includes("png")) {
      reject(new Error("Selecciona una imagen en formato PNG."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("No se pudo leer la imagen."));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}
