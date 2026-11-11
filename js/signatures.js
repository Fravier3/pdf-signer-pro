/**
 * signatures.js — Pantalla "Mis Firmas" e importación de imágenes PNG.
 * Todas las firmas se guardan en IndexedDB (ver db.js) y persisten
 * aunque se cierre el navegador.
 */
const SignaturesUI = (() => {
  let cache = [];
  // Orden de la tabla (solo presentación). null = orden original de la base
  // de datos (más recientes primero).
  let sortKey = null;
  let sortDir = "asc";
  let sortBound = false;

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const SORTERS = {
    name: (a, b) => collator.compare(a.name || "", b.name || ""),
    createdAt: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    size: (a, b) => (a.width || 0) * (a.height || 0) - (b.width || 0) * (b.height || 0),
  };

  async function refresh() {
    cache = await SignatureDB.getAll();
    render(true);
    return cache;
  }

  function sortedList() {
    if (!sortKey) return cache;
    const list = cache.slice().sort(SORTERS[sortKey]);
    return sortDir === "desc" ? list.reverse() : list;
  }

  function bindSortHeaders() {
    if (sortBound) return;
    sortBound = true;
    document.querySelectorAll("#signatures-table th[data-sort]").forEach((th) => {
      th.querySelector(".th-sort").addEventListener("click", () => {
        const key = th.dataset.sort;
        if (sortKey === key) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = key;
          // Fechas y tamaños empiezan por lo más reciente / grande.
          sortDir = key === "name" ? "asc" : "desc";
        }
        render(true);
      });
    });
  }

  function updateSortHeaders() {
    document.querySelectorAll("#signatures-table th[data-sort]").forEach((th) => {
      const active = th.dataset.sort === sortKey;
      if (active) th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
      const iconName = !active ? "arrow-up-down" : sortDir === "asc" ? "arrow-up" : "arrow-down";
      th.querySelector(".sort-icon").innerHTML = UI.icon(iconName);
    });
  }

  function render(animateRows) {
    const panelEl = document.getElementById("signatures-list");
    const bodyEl = document.getElementById("signatures-tbody");
    const emptyEl = document.getElementById("signatures-empty");
    bindSortHeaders();
    bodyEl.innerHTML = "";

    const count = cache.length;
    document.getElementById("signatures-count").textContent = count;
    const homeCount = document.getElementById("home-sig-count");
    if (homeCount) {
      homeCount.textContent = count;
      homeCount.hidden = count === 0;
    }

    emptyEl.hidden = count !== 0;
    panelEl.hidden = count === 0;
    if (count === 0) return;

    updateSortHeaders();

    sortedList().forEach((sig) => {
      const row = document.createElement("tr");
      const date = new Date(sig.createdAt).toLocaleDateString();
      const size = sig.width && sig.height ? `${sig.width} × ${sig.height} px` : "—";
      const safeName = escapeHtml(sig.name);
      row.innerHTML = `
        <td class="col-thumb"><div class="signature-thumb"><img src="${sig.dataUrl}" alt=""></div></td>
        <td class="col-name">
          <div class="signature-name">${safeName}</div>
          <div class="cell-sub num"><span>${date}</span><span class="sep"> · </span><span>${size}</span></div>
        </td>
        <td class="col-date col-secondary num">${date}</td>
        <td class="col-size col-secondary num">${size}</td>
        <td class="col-actions">
          <div class="signature-actions">
            <button class="icon-btn btn-rename" aria-label="Renombrar ${safeName}" title="Renombrar">${UI.icon("pencil")}</button>
            <button class="icon-btn btn-delete" aria-label="Eliminar ${safeName}" title="Eliminar">${UI.icon("trash-2")}</button>
          </div>
        </td>`;
      row.querySelector(".signature-name").title = sig.name;
      row.querySelector(".btn-rename").addEventListener("click", () => renamePrompt(sig));
      row.querySelector(".btn-delete").addEventListener("click", () => deleteConfirm(sig));
      bodyEl.appendChild(row);
    });

    // Solo se anima si la tabla está a la vista (si no, mediría 0).
    if (animateRows && panelEl.offsetParent !== null) UI.enterItems(bodyEl.querySelectorAll("tr"));
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML.replace(/"/g, "&quot;");
  }

  async function renamePrompt(sig) {
    const name = await UI.Dialog.prompt({
      title: "Renombrar firma",
      label: "Nuevo nombre para la firma",
      value: sig.name,
      icon: "pencil",
      confirmText: "Guardar",
    });
    if (!name || !name.trim()) return;
    await SignatureDB.rename(sig.id, name.trim());
    await refresh();
    Toast.show("Firma renombrada");
  }

  async function deleteConfirm(sig) {
    const ok = await UI.Dialog.confirm({
      title: "¿Eliminar esta firma?",
      message: `Se eliminará "${sig.name}". Esta acción no se puede deshacer.`,
      icon: "trash-2",
      danger: true,
      confirmText: "Eliminar",
    });
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
