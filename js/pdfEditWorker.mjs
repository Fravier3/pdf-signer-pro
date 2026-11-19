import { handlePdfEdit } from "./pdfEditEngine.mjs";

self.onmessage = async ({ data }) => {
  try {
    const result = await handlePdfEdit(data);
    self.postMessage({ id: data.id, result }, result instanceof ArrayBuffer ? [result] : []);
  } catch (err) {
    self.postMessage({ id: data.id, error: err.message || "No se pudo editar este PDF." });
  }
};
