/** Cámara en vivo y guía de las cuatro esquinas del documento. */
const ScanCamera = (() => {
  const dialog = document.getElementById("scan-live");
  const video = document.getElementById("scan-live-video");
  const guide = document.getElementById("scan-live-guide");
  const outline = guide.querySelector("polygon");
  const status = document.getElementById("scan-live-status");
  const shot = document.getElementById("scan-live-shot");
  const fallback = document.getElementById("scan-live-fallback");
  const input = document.getElementById("scan-live-file");
  const probe = ScanImage.canvas(1, 1);
  const probeContext = probe.getContext("2d", { alpha: false, willReadFrequently: true });
  const SEARCHING = "Encuadra la hoja completa.";
  let stream, timer, corners, previous;
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
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    previous = corners = null;
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

  function examine() {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      shot.disabled = false;
      const scale = 320 / Math.max(video.videoWidth, video.videoHeight);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (probe.width !== width || probe.height !== height) {
        probe.width = width;
        probe.height = height;
        previous = corners = null;
      }
      probeContext.drawImage(video, 0, 0, width, height);
      const found = ScanImage.detect(probe);
      // Dos observaciones cercanas evitan un destello verde por un borde pasajero.
      const stable = found && previous && found.every(([x, y], i) =>
        Math.hypot(x - previous[i][0], y - previous[i][1]) < 0.055);
      corners = stable ? found.map(([x, y], i) => {
        const [lastX, lastY] = corners?.[i] || previous[i];
        return [x * 0.65 + lastX * 0.35, y * 0.65 + lastY * 0.35];
      }) : null;
      previous = found;
      drawGuide(corners);
      setStatus(corners ? "Hoja detectada. Toca para capturar." : SEARCHING);
    }
    timer = setTimeout(examine, 120);
  }

  async function open() {
    if (dialog.open) return;
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
      if (opening === session) examine();
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
      if (file && dialog.open) onPhoto(file);
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
          onPhoto(photo);
          return;
        }

        const [width, height] = ScanImage.imageSize(video.videoWidth, video.videoHeight);
        const frame = ScanImage.canvas(width, height);
        frame.getContext("2d", { alpha: false }).drawImage(video, 0, 0, frame.width, frame.height);
        const capturedCorners = ScanImage.detect(frame);
        const blob = await new Promise((resolve) => frame.toBlob(resolve, "image/jpeg", 0.98));
        if (capturing !== session) return;
        if (!blob) throw new Error("No se pudo guardar la captura");
        onPhoto(new File([blob], "Escaneo.jpg", { type: "image/jpeg" }), capturedCorners);
      } catch {
        if (capturing === session) showFallback("No se pudo capturar la foto en vivo.");
      }
    });
  }

  return { init, open, close, isOpen: () => dialog.open };
})();
