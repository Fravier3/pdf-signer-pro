/** Cámara en vivo y guía de las cuatro esquinas del documento. */
const ScanCamera = (() => {
  const dialog = document.getElementById("scan-live");
  const video = document.getElementById("scan-live-video");
  const guide = document.getElementById("scan-live-guide");
  const outline = guide.querySelector("polygon");
  const status = document.getElementById("scan-live-status");
  const shot = document.getElementById("scan-live-shot");
  const fallback = document.getElementById("scan-live-fallback");
  const auto = document.getElementById("scan-live-auto");
  const title = document.getElementById("scan-live-title");
  const input = document.getElementById("scan-live-file");
  const probe = ScanImage.canvas(1, 1);
  const probeContext = probe.getContext("2d", { alpha: false, willReadFrequently: true });
  const SEARCHING = "Encuadra la hoja completa.";
  let stream, timer, corners, previous;
  let motor, stableSince, previewMotor, loading, guideFailed;
  let session = 0;
  let resumeAfterPicker = false;

  function setStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  function drawGuide(points) {
    const { videoWidth: width, videoHeight: height } = video;
    guide.setAttribute("viewBox", `0 0 ${width || 1} ${height || 1}`);
    outline.setAttribute("points", points?.map(([x, y]) => `${x * width},${y * height}`).join(" ") || "");
    shot.toggleAttribute("data-detected", !!points);
  }

  function stop() {
    session++;
    clearTimeout(timer);
    probe.width = probe.height = 1;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    previous = corners = null;
    stableSince = 0;
    drawGuide(null);
  }

  function close() {
    resumeAfterPicker = false;
    stop();
    if (dialog.open) dialog.close();
  }

  function showFallback(message) {
    stop();
    setStatus(message);
    shot.hidden = true;
    fallback.hidden = false;
    fallback.disabled = false;
  }

  async function examine(opening) {
    if (opening !== session) return;
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      shot.disabled = false;
      if (loading) {
        timer = setTimeout(() => examine(opening), 120);
        return;
      }
      if (guideFailed) return;
      const scale = 480 / Math.max(video.videoWidth, video.videoHeight);
      const width = Math.max(2, Math.round(video.videoWidth * scale));
      const height = Math.max(2, Math.round(video.videoHeight * scale));
      if (probe.width !== width || probe.height !== height) {
        probe.width = width;
        probe.height = height;
        previous = corners = null;
        stableSince = 0;
      }
      probeContext.drawImage(video, 0, 0, width, height);
      try {
        const { corners: found, quality } = await ScanEngines.detect(previewMotor, probe);
        if (opening !== session || shot.disabled) return;
        const stable = found && previous && found.every(([x, y], i) =>
          Math.hypot(x - previous[i][0], y - previous[i][1]) < 0.018);
        corners = found && stable ? found.map(([x, y], i) => {
          const [lastX, lastY] = corners?.[i] || previous[i];
          return [x * 0.65 + lastX * 0.35, y * 0.65 + lastY * 0.35];
        }) : found;
        previous = found;
        drawGuide(corners);
        const warning = quality?.isDark ? "Poca luz." : quality?.isBlurry ? "La imagen podría estar borrosa." : "";
        if (auto.checked && stable && !warning) {
          const now = performance.now();
          stableSince ||= now;
          if (now - stableSince >= 850) { shot.click(); return; }
          setStatus("Mantén la hoja quieta…");
        } else {
          stableSince = 0;
          setStatus(warning || (corners ? "Hoja detectada. Toca para capturar." : SEARCHING));
        }
      } catch {
        if (opening !== session || shot.disabled) return;
        drawGuide(null);
        stableSince = 0;
        setStatus("Guía de bordes no disponible. Puedes capturar manualmente.");
        return;
      }
    }
    timer = setTimeout(() => examine(opening), 120);
  }

  async function open(engine) {
    if (dialog.open) return;
    motor = engine;
    previewMotor = engine === "compare" ? "pdfpro" : engine;
    title.textContent = engine === "compare" ? "Comparar · guía PDF Pro" : ScanEngines.names[engine];
    dialog.showModal();
    await startPreview();
  }

  async function startPreview() {
    const opening = ++session;
    shot.disabled = true;
    shot.hidden = false;
    fallback.hidden = false;
    fallback.disabled = false;
    setStatus("Abriendo cámara…");
    guideFailed = false;
    loading = previewMotor !== "pdfpro";
    if (loading) {
      ScanEngines.prepare(previewMotor).then(() => {
        if (opening === session) loading = false;
      }).catch(() => {
        if (opening === session) {
          loading = false;
          guideFailed = true;
          setStatus(ScanEngines.names[previewMotor] + " no pudo abrir la guía. Puedes cambiar de motor.");
        }
      });
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },
          height: { ideal: 2880 },
          frameRate: { ideal: 24 },
        },
        audio: false,
      });
      if (opening !== session) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = media;
      if (document.hidden) {
        close();
        return;
      }
      media.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (session === opening) showFallback("Se interrumpió la vista en vivo.");
      });
      video.srcObject = media;
      await video.play();
      if (opening === session) {
        if (loading) setStatus("Cargando " + ScanEngines.names[previewMotor] + "…");
        examine(opening);
      }
    } catch {
      if (opening === session) showFallback("La vista en vivo no está disponible.");
    }
  }

  async function takeStillPhoto(track) {
    if (!track || typeof ImageCapture !== "function") return null;
    try {
      const photo = await new ImageCapture(track).takePhoto();
      return photo?.size ? photo : null;
    } catch {
      return null;
    }
  }

  function init({ onPhoto, onClose }) {
    document.getElementById("scan-live-close").addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("close", onClose);
    window.addEventListener("pagehide", close);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && stream) close();
    });
    fallback.addEventListener("click", () => {
      resumeAfterPicker = !shot.hidden;
      showFallback("Toma una foto con la cámara del dispositivo.");
      input.click();
    });
    input.addEventListener("cancel", () => {
      if (dialog.open && resumeAfterPicker) startPreview();
      resumeAfterPicker = false;
    });
    input.addEventListener("change", () => {
      const [file] = input.files;
      input.value = "";
      if (file && dialog.open) onPhoto(file, motor);
    });
    shot.addEventListener("click", async () => {
      if (shot.disabled || !video.videoWidth || !video.videoHeight) return;
      const capturing = session;
      clearTimeout(timer);
      shot.disabled = true;
      fallback.disabled = true;
      setStatus("Capturando…");
      try {
        const photo = await takeStillPhoto(stream?.getVideoTracks()[0]);
        if (capturing !== session) return;
        // La foto fija puede tener un encuadre distinto al del video.
        if (photo) {
          onPhoto(photo, motor);
          return;
        }

        const frame = ScanImage.canvas(video.videoWidth, video.videoHeight);
        frame.getContext("2d", { alpha: false }).drawImage(video, 0, 0, frame.width, frame.height);
        const blob = await new Promise((resolve) => frame.toBlob(resolve, "image/jpeg", 0.98));
        frame.width = frame.height = 1;
        if (capturing !== session) return;
        if (!blob) throw new Error("No se pudo guardar la captura");
        onPhoto(new File([blob], "Escaneo.jpg", { type: "image/jpeg" }), motor);
      } catch {
        if (capturing === session) showFallback("No se pudo capturar la foto en vivo.");
      }
    });
  }

  return { init, open, close, isOpen: () => dialog.open };
})();
