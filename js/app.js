/**
 * app.js — Punto de entrada. Inicializa módulos, gestiona la navegación
 * entre pantallas y conecta todos los botones de la interfaz.
 */
(function () {
  const screens = {
    home: document.getElementById("screen-home"),
    viewer: document.getElementById("screen-viewer"),
    signatures: document.getElementById("screen-signatures"),
    newSignature: document.getElementById("screen-new-signature"),
    settings: document.getElementById("screen-settings"),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  // -------------------- NAVEGACIÓN --------------------
  document.getElementById("btn-my-signatures").addEventListener("click", async () => {
    await SignaturesUI.refresh();
    showScreen("signatures");
  });
  document.getElementById("btn-back-from-signatures").addEventListener("click", () => showScreen("home"));

  document.getElementById("btn-new-signature").addEventListener("click", () => openNewSignatureScreen());
  document.getElementById("btn-add-signature-top").addEventListener("click", () => openNewSignatureScreen());
  document.getElementById("btn-empty-add-signature").addEventListener("click", () => openNewSignatureScreen());
  document.getElementById("btn-close-new-signature").addEventListener("click", () => showScreen("home"));

  document.getElementById("btn-settings").addEventListener("click", () => showScreen("settings"));
  document.getElementById("btn-open-settings").addEventListener("click", () => showScreen("settings"));
  document.getElementById("btn-back-from-settings").addEventListener("click", () => showScreen("home"));

  function openNewSignatureScreen() {
    resetNewSignatureForm();
    showScreen("newSignature");
  }

  // -------------------- ABRIR PDF --------------------
  const fileInputPdf = (() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.style.display = "none";
    document.body.appendChild(input);
    return input;
  })();

  document.getElementById("btn-open-pdf").addEventListener("click", () => fileInputPdf.click());
  fileInputPdf.addEventListener("change", async () => {
    const file = fileInputPdf.files[0];
    fileInputPdf.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      Toast.show("Selecciona un archivo PDF válido");
      return;
    }
    PlacementManager.reset();
    try {
      await PdfViewer.openFile(file);
      showScreen("viewer");
    } catch (err) {
      console.error(err);
      Toast.show("No se pudo abrir el PDF");
    }
  });

  document.getElementById("btn-close-viewer").addEventListener("click", closeDocumentToHome);
  document.getElementById("action-close-doc").addEventListener("click", () => {
    BottomSheet.close();
    closeDocumentToHome();
  });

  function closeDocumentToHome() {
    PdfViewer.reset();
    PlacementManager.reset();
    showScreen("home");
  }

  document.getElementById("btn-viewer-undo").addEventListener("click", () => PlacementManager.undo());

  // -------------------- BOTTOM SHEET: ACCIONES --------------------
  document.getElementById("action-insert-signature").addEventListener("click", async () => {
    BottomSheet.close();
    await handleInsertSignatureFlow();
  });
  document.getElementById("action-new-signature").addEventListener("click", () => {
    BottomSheet.close();
    openNewSignatureScreen();
    pendingReturnToViewer = true;
  });
  document.getElementById("action-save-pdf").addEventListener("click", async () => {
    BottomSheet.close();
    await PdfExporter.saveToDevice();
  });
  document.getElementById("action-share-pdf").addEventListener("click", async () => {
    BottomSheet.close();
    await PdfExporter.shareFile();
  });

  let pendingReturnToViewer = false;

  async function handleInsertSignatureFlow() {
    const list = await SignaturesUI.getAllCached();
    if (!list || list.length === 0) {
      Toast.show("Primero crea una firma");
      openNewSignatureScreen();
      pendingReturnToViewer = true;
      return;
    }
    const chosen = await SignaturePickerSheet.open(list);
    if (!chosen) return;
    const currentPage = getCurrentVisiblePage();
    PlacementManager.insertSignature(currentPage, chosen);
    Toast.show("Firma insertada — arrástrala para colocarla");
  }

  function getCurrentVisiblePage() {
    const text = document.getElementById("viewer-page-indicator").textContent || "1 / 1";
    const n = parseInt(text.split("/")[0].trim(), 10);
    return Number.isFinite(n) ? n : 1;
  }

  // -------------------- NUEVA FIRMA: TABS --------------------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "draw") {
        setTimeout(() => DrawSignature.resizeCanvasToDisplaySize(), 50);
      }
    });
  });

  // -------------------- IMPORTAR PNG --------------------
  let importedSignature = null;
  const inputImportPng = document.getElementById("input-import-png");
  inputImportPng.addEventListener("change", async () => {
    const file = inputImportPng.files[0];
    if (!file) return;
    try {
      const result = await readPngFile(file);
      importedSignature = result;
      const previewWrap = document.getElementById("import-preview-wrap");
      const previewImg = document.getElementById("import-preview");
      previewImg.src = result.dataUrl;
      previewWrap.hidden = false;
    } catch (err) {
      Toast.show(err.message || "No se pudo importar la imagen");
    }
  });

  // -------------------- GUARDAR FIRMA --------------------
  document.getElementById("btn-save-signature").addEventListener("click", async () => {
    const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
    const nameInput = document.getElementById("signature-name-input");
    const name = nameInput.value.trim() || "Firma";

    let payload = null;
    if (activeTab === "draw") {
      if (DrawSignature.isEmpty()) {
        Toast.show("Dibuja tu firma antes de guardar");
        return;
      }
      payload = DrawSignature.exportPng();
    } else {
      if (!importedSignature) {
        Toast.show("Selecciona una imagen PNG antes de guardar");
        return;
      }
      payload = importedSignature;
    }

    if (!payload) {
      Toast.show("No se pudo procesar la firma");
      return;
    }

    await SignatureDB.add({
      name,
      dataUrl: payload.dataUrl,
      width: payload.width,
      height: payload.height,
    });
    await SignaturesUI.refresh();
    Toast.show("Firma guardada");
    resetNewSignatureForm();

    if (pendingReturnToViewer) {
      pendingReturnToViewer = false;
      showScreen("viewer");
    } else {
      showScreen("signatures");
    }
  });

  function resetNewSignatureForm() {
    DrawSignature.clear();
    importedSignature = null;
    document.getElementById("import-preview-wrap").hidden = true;
    document.getElementById("input-import-png").value = "";
    document.getElementById("signature-name-input").value = "";
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.querySelector('.tab-btn[data-tab="draw"]').classList.add("active");
    document.getElementById("tab-draw").classList.add("active");
  }

  // -------------------- CONFIGURACIÓN --------------------
  document.getElementById("btn-clear-signatures").addEventListener("click", async () => {
    const ok = window.confirm("¿Borrar todas las firmas guardadas? Esta acción no se puede deshacer.");
    if (!ok) return;
    await SignatureDB.clearAll();
    await SignaturesUI.refresh();
    Toast.show("Todas las firmas fueron eliminadas");
  });

  // -------------------- INIT --------------------
  async function init() {
    ThemeManager.init();
    BottomSheet.init();
    SignaturePickerSheet.init();
    DrawSignature.init();
    await SignaturesUI.refresh();
    registerServiceWorker();
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch((err) => {
          console.warn("No se pudo registrar el service worker:", err);
        });
      });
    }
  }

  init();
})();
