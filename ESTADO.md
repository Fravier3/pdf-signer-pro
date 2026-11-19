# Estado de PDF Pro

Última actualización | 18 de noviembre de 2026 · Codex

## Objetivo

Añadir «Editar» al visor de PDF Pro para corregir texto nativo y escaneado, transformar objetos independientes y guardar una copia.

## Stack

PWA estática en GitHub Pages. HTML, CSS y JavaScript, PDF.js para el visor, pdf-lib para exportación y service worker para instalación y caché.

## Hecho y verificado

- Se revisó `main` en `c42e4d9`, las ramas remotas, el historial y el árbol de trabajo limpio. La última actualización de `main` verifica los cuatro bordes al escanear. No se encontró un módulo previo de edición ni archivos de continuidad en el historial disponible. La rama de trabajo es `editar-pdf`.
- Se consultó RepoVault. Stirling-PDF es la alternativa de edición que figura en el catálogo. Su distribución incluye un backend y componentes con licencias distintas. MarkItDown y Filee convierten formatos, con un objetivo distinto a editar contenido PDF en el visor.
- Se revisó ClearPDF Editor de PDFCraft. Su código usa React, PDF.js y pdf-lib para editar texto. En `src/lib/pdfExporter.ts` pinta un rectángulo sobre el texto original y dibuja el reemplazo, por lo que los operadores de texto original siguen presentes. El paquete carece de motor OCR y de herramientas para transformar objetos PDF originales. MuPDF.js ofrece edición y redacción en WASM bajo AGPL o licencia comercial. PDFium WebAssembly de EmbedPDF (envoltorio MIT y avisos del motor) expone objetos de página, edición de texto, matrices y guardado. Se eligió PDFium para editar los objetos y Tesseract.js (Apache-2.0) para OCR local.

## Implementado, pendiente de prueba integral

- «Editar» se integró al visor. Incluye selección de texto, transformación de imágenes o gráficos, OCR de palabras o líneas, deshacer y exportación por los botones existentes.
- PDFium procesa las operaciones en un worker. La edición de OCR corrige los píxeles de la imagen en la zona elegida, retira el texto OCR superpuesto compatible y agrega texto seleccionable. Los recursos de PDFium y Tesseract se descargan cuando se usan.
- Una prueba aislada de PDFium con un documento de dos páginas confirmó el reemplazo de texto, la transformación de un vector y la conservación del texto de la segunda página. `pdftotext` confirmó que el texto anterior ya no era seleccionable.

## En progreso y siguiente paso

Ejecutar las pruebas del visor y de Scan con PDFs de texto, imagen independiente y escaneo con capa OCR. La selección ya usa captura de puntero y controles alternos de teclado.

## Pendientes y problemas conocidos

- Falta verificar el flujo de punta a punta y la interacción móvil.
- El push por CLI solicita credenciales. La rama remota se creó mediante el conector de GitHub y se usará esa conexión para guardar los commits.

## Ejecutar y probar

En la raíz, ejecuta `python3 -m http.server 8000` y abre `http://localhost:8000/`. Carga PDFs de prueba desde Inicio. Para revisar la PWA, usa el panel Application de Chromium y comprueba el service worker en localhost.
