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

  let currentScreen = "home";

  function showScreen(name) {
    const next = screens[name];
    const changed = name !== currentScreen || !next.classList.contains("active");
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    next.classList.add("active");
    currentScreen = name;
    document.body.dataset.screen = name;

    // Cada sección abre siempre desde arriba. (El visor de PDF conserva su
    // posición: es el documento del usuario, no una sección de la app.)
    next.querySelectorAll("[data-scroll]").forEach((el) => {
      el.scrollTop = 0;
    });

    updateNav(name);
    UI.syncSliders(!changed);
    if (changed) UI.enterView(next);
  }

  // -------------------- MENÚ (lateral / barra inferior) --------------------
  const navButtons = Array.from(document.querySelectorAll("#nav-items .nav-item"));

  function updateNav(name) {
    // "Documento" solo existe mientras haya un PDF abierto.
    document.getElementById("nav-document").hidden = !PdfViewer.hasDocument();
    navButtons.forEach((btn) => {
      const on = btn.dataset.nav === name;
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  const navHandlers = {
    home: () => showScreen("home"),
    viewer: () => showScreen("viewer"),
    signatures: async () => {
      await SignaturesUI.refresh();
      showScreen("signatures");
    },
    newSignature: () => {
      if (currentScreen !== "newSignature") openNewSignatureScreen();
    },
    settings: () => showScreen("settings"),
  };
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => navHandlers[btn.dataset.nav]());
  });

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
    // El canvas debe medirse DESPUÉS de que la pantalla sea visible;
    // si se mide oculta (display:none) obtiene ancho/alto de 0.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => DrawSignature.resizeCanvasToDisplaySize());
    });
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

  let pdfInputAction = "open";
  let pdfInputBusy = false;
  function pickPdf(action) {
    if (pdfInputBusy) return;
    pdfInputAction = action;
    fileInputPdf.click();
  }

  document.getElementById("btn-open-pdf").addEventListener("click", () => pickPdf("open"));
  document.getElementById("action-append-pdf").addEventListener("click", () => {
    BottomSheet.close();
    pickPdf("append");
  });
  fileInputPdf.addEventListener("change", async () => {
    const file = fileInputPdf.files[0];
    fileInputPdf.value = "";
    if (!file || pdfInputBusy) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      Toast.show("Selecciona un archivo PDF válido");
      return;
    }
    const appending = pdfInputAction === "append";
    pdfInputBusy = true;
    if (appending) Loader.show("Añadiendo PDF…");
    try {
      if (appending) {
        const added = await PdfViewer.appendFile(file);
        if (added) Toast.show(added === 1 ? "Se añadió 1 página al final" : `Se añadieron ${added} páginas al final`);
      } else {
        await PdfViewer.openFile(file);
        PlacementManager.reset();
        showScreen("viewer");
      }
    } catch (err) {
      console.error(err);
      Toast.show(appending ? "No se pudo añadir el PDF. Verifica que el archivo se pueda abrir y no esté protegido." : "No se pudo abrir el PDF");
    } finally {
      if (appending) Loader.hide();
      pdfInputBusy = false;
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
    // Sin documento ya no tiene sentido "volver al visor" tras guardar una firma.
    pendingReturnToViewer = false;
    showScreen("home");
    applyUpdateIfSafe();
  }

  document.getElementById("btn-viewer-undo").addEventListener("click", () => PlacementManager.undo());

  // -------------------- BARRA DEL VISOR (fuera del documento) --------------------
  document.getElementById("btn-zoom-in").addEventListener("click", () => PdfViewer.zoomIn());
  document.getElementById("btn-zoom-out").addEventListener("click", () => PdfViewer.zoomOut());
  document.getElementById("btn-zoom-reset").addEventListener("click", () => PdfViewer.resetZoom());
  PdfViewer.setOnZoomChange((scale) => {
    document.getElementById("btn-zoom-reset").textContent = Math.round(scale * 100) + "%";
  });
  document.getElementById("dock-insert-signature").addEventListener("click", () => handleInsertSignatureFlow());
  document.getElementById("dock-save-pdf").addEventListener("click", () => PdfExporter.saveToDevice());
  document.getElementById("dock-share-pdf").addEventListener("click", () => PdfExporter.shareFile());

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
  function setActiveTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    const panel = document.getElementById(`tab-${tab}`);
    panel.classList.add("active");
    UI.syncSliders();
    return panel;
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      const panel = setActiveTab(btn.dataset.tab);
      UI.animate(panel, { opacity: [0, 1], y: [10, 0] }, { duration: 0.28, ease: "easeOut" });
      if (btn.dataset.tab === "draw") {
        setTimeout(() => DrawSignature.resizeCanvasToDisplaySize(), 50);
      }
    });
  });

  // -------------------- IMPORTAR PNG --------------------
  let importedSignature = null;
  const inputImportPng = document.getElementById("input-import-png");
  // La zona de importación es un <label>; con teclado se activa con Enter/Espacio.
  document.querySelector(".import-drop").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputImportPng.click();
    }
  });
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
      UI.animate(previewWrap, { opacity: [0, 1], scale: [0.97, 1] }, { duration: 0.3, ease: "easeOut" });
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
      // Si el usuario llegó aquí porque quería insertar una firma y aún
      // no tenía ninguna, continuamos el flujo de inserción automáticamente
      // en vez de dejarlo de nuevo en el visor sin hacer nada.
      setTimeout(() => handleInsertSignatureFlow(), 200);
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
    setActiveTab("draw");
  }

  // -------------------- CONFIGURACIÓN --------------------
  document.getElementById("btn-clear-signatures").addEventListener("click", async () => {
    const ok = await UI.Dialog.confirm({
      title: "¿Borrar todas las firmas?",
      message: "Se eliminarán todas las firmas guardadas. Esta acción no se puede deshacer.",
      icon: "trash-2",
      danger: true,
      confirmText: "Borrar todo",
    });
    if (!ok) return;
    await SignatureDB.clearAll();
    await SignaturesUI.refresh();
    Toast.show("Todas las firmas fueron eliminadas");
  });

  // -------------------- INIT --------------------
  function hideSplash() {
    const splash = document.getElementById("splash");
    setTimeout(() => {
      Promise.resolve(UI.animate(splash, { opacity: 0 }, { duration: 0.6, ease: "easeOut" })).then(() => {
        splash.hidden = true;
      });
    }, 1100);
  }

  async function init() {
    UI.init();
    UI.registerSlider(document.getElementById("nav-items"), ".nav-item.active");
    UI.registerSlider(document.querySelector(".new-signature-tabs"), ".tab-btn.active");
    UI.registerSlider(document.getElementById("theme-segmented"), ".segmented-btn.active");
    hideSplash();
    ThemeManager.init();
    BottomSheet.init();
    PdfExporter.init();
    SignaturePickerSheet.init();
    DrawSignature.init();
    await SignaturesUI.refresh();
    registerServiceWorker();
    updateNav(currentScreen);
    UI.syncSliders(true);
    UI.enterView(screens.home);
  }

  // -------------------- SERVICE WORKER + AUTO-ACTUALIZACIÓN --------------------
  // Cuando se publica una versión nueva, el service worker nuevo toma el
  // control y la app se recarga sola para mostrarla. Si hay un PDF abierto
  // NO se recarga (se perderían las firmas colocadas): se aplica al cerrarlo.
  let updatePending = false;

  function applyUpdateIfSafe() {
    if (!updatePending) return;
    if (PdfViewer.hasDocument()) {
      Toast.show("Nueva versión lista: se aplicará al cerrar el documento", 3500);
      return;
    }
    updatePending = false;
    window.location.reload();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // Solo es una ACTUALIZACIÓN si ya había un service worker controlando la
    // página; en la primera instalación no hay nada que recargar.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return;
      updatePending = true;
      applyUpdateIfSafe();
    });

    const register = () => {
      navigator.serviceWorker
        .register("service-worker.js", { updateViaCache: "none" })
        .then((reg) => {
          // Las apps instaladas pueden pasar días abiertas en segundo plano:
          // se busca una versión nueva cada vez que la app vuelve a primer plano.
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") reg.update().catch(() => {});
          });
        })
        .catch((err) => {
          console.warn("No se pudo registrar el service worker:", err);
        });
    };
    // Esta función se ejecuta tras cargar las firmas (asíncrono), cuando el
    // evento "load" normalmente YA ocurrió: esperar solo a "load" hacía que
    // el service worker no llegara a registrarse.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);
  }

  init();
})();
