# Estado de PDF Pro

Última actualización | 18 de noviembre de 2026 · Codex

## Objetivo

Añadir «Editar» al visor de PDF Pro para corregir texto nativo y escaneado, transformar objetos independientes y guardar una copia.

## Stack

PWA estática en GitHub Pages. HTML, CSS y JavaScript, PDF.js para el visor, pdf-lib para exportación y service worker para instalación y caché.

## Hecho y verificado

- Se revisó `main` en `c42e4d9`, las ramas remotas, el historial y el árbol de trabajo limpio. La última actualización de `main` verifica los cuatro bordes al escanear. No se encontró un módulo previo de edición ni archivos de continuidad en el historial disponible. La rama de trabajo es `editar-pdf`.
- Se consultó RepoVault. Stirling-PDF es la alternativa de edición que figura en el catálogo. Su distribución incluye un backend y componentes con licencias distintas. MarkItDown y Filee convierten formatos, con un objetivo distinto a editar contenido PDF en el visor.
- Se revisó ClearPDF Editor de PDFCraft. Su código usa React, PDF.js y pdf-lib para editar texto. El paquete carece de motor OCR y de herramientas para transformar objetos PDF originales. MuPDF.js ofrece edición y redacción en WASM bajo AGPL o licencia comercial. PDFium WebAssembly de EmbedPDF (envoltorio MIT y avisos del motor) expone objetos de página, edición de texto, matrices y guardado. Se eligió PDFium para editar los objetos y Tesseract.js (Apache-2.0) para OCR local.

## En progreso y siguiente paso

Comprobar las operaciones PDFium sobre archivos de prueba y conectarlas al visor existente. Aplicar la guía de arrastre de Modern Web Guidance para capturar el puntero y ofrecer controles accesibles.

## Pendientes y problemas conocidos

- Implementar las herramientas, probar PDFs de texto, escaneo e imágenes, y verificar el escáner y el visor.
- El push por CLI solicita credenciales. La rama remota se creó mediante el conector de GitHub y se usará esa conexión para guardar los commits.

## Ejecutar y probar

En la raíz, ejecuta `python3 -m http.server 8000` y abre `http://localhost:8000/`. Carga PDFs de prueba desde Inicio. Para revisar la PWA, usa el panel Application de Chromium y comprueba el service worker en localhost.
