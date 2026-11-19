# Estado de PDF Pro

Última actualización | 18 de noviembre de 2026 · Codex

## Objetivo

Añadir «Editar» al visor existente para corregir texto nativo y escaneado, transformar objetos independientes y guardar una copia.

## Stack

PWA estática en GitHub Pages. HTML, CSS y JavaScript. PDF.js 2.6.347 para el visor, pdf-lib para combinar y firmar, PDFium de EmbedPDF para editar y Tesseract.js para OCR local. El service worker guarda el código y las dependencias de edición solicitadas.

## Hecho

- Se partió de `main` en `c42e4d9`. Se revisaron las ramas, el historial y el árbol limpio. El proyecto no tenía implementación previa de «Editar» ni los archivos de continuidad. Los commits se prepararon en `editar-pdf`. GitHub Pages publica desde `main`.
- «Editar» se abre dentro del visor. «Texto» sustituye contenido seleccionable nativo. En escaneos con una imagen de página independiente, OCR reconoce palabras y líneas en español e inglés, corrige los píxeles de la selección y agrega texto seleccionable. También retira el texto anterior de una capa OCR superpuesta compatible.
- «Objetos» permite seleccionar imágenes o gráficos, mover el marco por arrastre o con las flechas, ajustar el tamaño y girar. Las ediciones tienen su propio botón Deshacer y se exportan desde los controles de Guardar y Compartir ya existentes.
- Se actualizaron `AGENTS.md`, `CLAUDE.md` y `README.md`. El push por CLI requiere autenticación en este entorno. Se guardaron los avances en GitHub usando su conexión autorizada.

## Decisiones técnicas

- En RepoVault, Stirling-PDF fue la alternativa de edición. Su distribución incluye un backend y componentes con licencias propias. MarkItDown y Filee se orientan a conversión de formatos.
- En ClearPDF Editor de PDFCraft, `src/lib/pdfExporter.ts` dibuja un rectángulo y el texto nuevo sobre los operadores originales. Los operadores anteriores siguen en el PDF exportado. El paquete carece de OCR y de manipulación de objetos PDF existentes.
- MuPDF.js ofrece edición y redacción en WASM bajo AGPL o licencia comercial. PDFium de EmbedPDF ejecuta WASM en el navegador y expone el contenido, las matrices y el guardado que requiere la edición. Se eligió su envoltorio 2.15.1 (MIT, con licencia y avisos propios de PDFium), con Tesseract.js 6.0.1 y su núcleo 6.1.2 (Apache-2.0) para OCR. Se descargan bajo demanda. La app conserva el visor actual y procesa los archivos localmente.
- Se aplicó la [guía de arrastre de Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/drag.md) para el marco, con captura del puntero, umbral de movimiento y control por teclado. El encabezado sigue usando la estructura opaca y las zonas seguras del visor.

## Verificado

- Chromium de escritorio y Chromium con viewport de 390 × 844 y entrada táctil simulada. El visor permitió corregir texto nativo, arrastrar y transformar una imagen, deshacer la rotación, reconocer texto de un escaneo con una capa OCR previa y guardar la copia. `pdftotext` confirmó que las correcciones eran seleccionables y que el texto anterior ya no se extraía.
- Se comprobó movimiento, rotación y escala de una imagen independiente, además de la transformación de un vector en una prueba del motor. Se comparó con `pdftoppm` una página intacta y, en una segunda prueba, una página que compartía el mismo recurso de imagen con la hoja corregida. Las imágenes de comparación coincidieron píxel por píxel.
- Regresión de Scan y del visor en Chromium. Se importó una foto, se ajustó el recorte, se aplicó un filtro y se generó el PDF. Se verificaron zoom, adición de otro PDF, inserción de una firma PNG, exportación por la alternativa de descarga de Compartir y regreso al borrador.
- El OCR y la selección de texto nativo funcionaron sin conexión en Chromium con la caché preparada. Para las pruebas de navegador se sirvieron localmente las mismas versiones de las dependencias porque el Chromium del entorno no alcanzó el CDN. Se comprobaron por separado las respuestas públicas de los recursos del CDN.
- Se corrigió un fallo de inicialización reproducible al pasar modelos como objetos a Tesseract.js 6.0.1. Se usa su forma estándar `spa+eng`. También se corrigió el uso de una opción de anotaciones no expuesta por PDF.js 2.6.347.

- GitHub Pages publicó «Editar» desde `main`. Se verificaron en la URL pública el botón del visor, el módulo del editor y el service worker.
- Se corrigió la actualización de las pestañas que siguen abiertas desde la primera instalación. Chromium móvil emulado conservó el PDF activo y recargó al cerrarlo en dos pruebas: de v16 a v18 con un controlador previo y de una instalación nueva de v18 a una versión de prueba posterior.

- Se añadió «Editar PDF» a Inicio, entre «Abrir PDF» y «Scan». En Chromium móvil emulado se verificó que el botón abre el selector, entra a edición y permite corregir una frase. También se verificaron «Abrir PDF» y el botón «Editar» del visor.

- «Texto» abre por defecto en «Párrafos», con una caja de varias líneas. El texto nativo reconstruye renglones y párrafos por posición. OCR usa los bloques del motor de reconocimiento. Se probó en Chromium táctil emulado con un PDF que guarda cada letra por separado, una segunda columna y un párrafo escaneado de dos líneas. Se verificó con `pdftotext` que desapareció el texto nativo anterior y que las correcciones y los bloques vecinos permanecieron seleccionables. Se volvió a probar OCR por palabras y líneas, objetos y exportación. También se verificó, comparando píxeles del escaneo exportado, que un pie separado por espacio amplio conserva su imagen al editar el párrafo superior.

## Pendientes, límites y siguiente paso

- Ejecutar el mismo recorrido en Safari de iPhone y Chrome de Android físicos, tanto en pestaña como con la PWA instalada. La prueba de WebKit en Linux quedó bloqueada por bibliotecas del sistema ausentes. Quedan por comprobar el teclado de iOS, cámara física y el menú nativo de Guardar o Compartir.
- La detección de párrafos nativos se basa en la posición del texto. Si la maquetación mezcla columnas, tipografías o espaciados, se puede cambiar a «Líneas» o «Fragmentos». El editor opera sobre objetos de primer nivel. El OCR necesita una imagen de página independiente. Cuando la capa OCR previa agrupa varias palabras, usa la línea completa. Los logos impresos dentro de la foto de la hoja requieren una herramienta adicional de recorte y relleno. Las fuentes incrustadas pueden sustituirse por una base de estilo similar. Añadir páginas reinicia el historial de Deshacer.
- Primer paso para retomar. Prueba los tres casos en un iPhone físico con la [app de GitHub Pages](https://fravier3.github.io/pdf-signer-pro/) y actualiza este archivo con los resultados.

## Ejecutar y probar

1. En la raíz ejecuta `python3 -m http.server 8000` y abre `http://localhost:8000/`.
2. Abre un PDF de dos páginas con texto nativo. Corrige una frase de la primera página y guarda. Abre la copia y busca la frase original y la nueva. Confirma que el texto de la segunda página siga presente.
3. Abre un PDF escaneado con una foto de página y texto legible. Usa «Editar», «Texto», «OCR». Prueba una palabra y una línea. Si tiene una capa OCR anterior que abarca una línea, corrige la línea completa y verifica que la frase anterior no se pueda seleccionar.
4. Abre un PDF con una imagen o gráfico independiente. Usa «Objetos», arrastra y cambia tamaño. Gira, deshaz, guarda y reabre el resultado.
5. Repite el flujo de Scan importando una foto. Aplica filtro y recorte, crea el PDF, prueba zoom, añade otro PDF, inserta una firma y guarda o comparte. Revisa el service worker en el panel Application de Chromium.
