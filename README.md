# PDF Signer Pro

Aplicación web (PWA) para abrir y escanear PDFs, corregir texto, mover objetos e insertar firmas PNG o dibujadas a mano. El archivo exportado es una copia. Los documentos, las fotos y las firmas se procesan en el dispositivo.

## Ejecutar e instalar

Las librerías del visor y la exportación están incluidas en `js/lib/`. Para ejecutar localmente, usa `python3 -m http.server 8000` en la raíz y abre `http://localhost:8000/`.

En GitHub Pages, publica la raíz de la rama principal. Abre [PDF Pro](https://fravier3.github.io/pdf-signer-pro/) y usa «Añadir a pantalla de inicio» en iPhone o «Instalar aplicación» en Android.

## Estructura del proyecto

```
PDFSignerPro/
├── index.html
├── manifest.json
├── service-worker.js
├── css/
│   └── style.css
├── icons/                  (iconos PWA en todos los tamaños)
├── js/
│   ├── app.js               → controlador principal / navegación
│   ├── ui.js                → capa de interfaz: animaciones (Motion), iconos (Lucide), diálogos
│   ├── db.js                → almacenamiento de firmas (IndexedDB)
│   ├── theme.js              → modo claro / oscuro / automático
│   ├── toast.js               → notificaciones y loader
│   ├── bottomSheet.js          → FAB y hojas inferiores
│   ├── signatures.js            → pantalla "Mis Firmas" + importar PNG
│   ├── drawSignature.js          → dibujar firma a mano (canvas)
│   ├── pdfViewer.js                → visor PDF.js + gestos de zoom/pan
│   ├── placement.js                 → mover/escalar/rotar/duplicar firmas
│   ├── exportPdf.js                  → exportar PDF final con pdf-lib
│   ├── pdfEditor.js / pdfEditEngine.mjs / pdfEditOcr.mjs → edición de objetos PDF y OCR local
│   ├── scan.js / scanCamera.js / scanImage.js → escáner: cámara, detección de bordes, perspectiva, filtros
│   └── lib/                           → PDF.js, pdf-lib, Motion y subconjunto de iconos Lucide
```

## Interfaz

- **Navegación**: menú lateral en escritorio y barra inferior flotante en
  teléfono, con indicador deslizante. Cada sección tiene su propio scroll y
  abre siempre desde arriba.
- **Animación**: [Motion](https://motion.dev) (MIT), incluida en
  `js/lib/motion.min.js` para funcionar offline. Se respeta
  `prefers-reduced-motion`.
- **Iconos**: [Lucide](https://lucide.dev) (ISC). Solo los iconos usados,
  en `js/lib/lucide-icons.js`. Para añadir uno, copia su contenido SVG a ese
  archivo y úsalo con `<i data-icon="nombre"></i>` o `UI.icon("nombre")`.
- **Paleta**: los colores viven en las variables de `css/style.css`; los
  tonos auxiliares se derivan de ellas con `color-mix()`.
- **Actualizaciones**: al cambiar cualquier archivo, sube `CACHE_NAME` en
  `service-worker.js`. Con eso, las apps instaladas descargan la versión
  nueva y se recargan solas al abrirse o al volver a primer plano (si hay un
  PDF abierto, esperan a que se cierre para no perder trabajo).

## Funcionalidades incluidas

- Visor de PDF con scroll vertical, indicador de página y carga perezosa
  (lazy loading) por página, apto para documentos grandes.
- Zoom con pellizco (pinch), doble toque y arrastre, similar a Fotos de iPhone.
- Importar firmas PNG con transparencia; guardarlas todas (nombre, miniatura,
  renombrar, eliminar) en IndexedDB — persisten aunque cierres el navegador.
- Dibujar firma a mano con el dedo/mouse, con selector de color y recorte
  automático al área dibujada.
- Insertar la misma firma un número ilimitado de veces, en cualquier página.
- Mover, escalar, rotar, duplicar y eliminar cada firma colocada mediante
  gestos táctiles, con deshacer (undo).
- Exportación con **pdf-lib**: las firmas quedan incrustadas de forma
  permanente en un PDF nuevo; el original nunca se modifica.
- Compartir con la Web Share API (AirDrop, WhatsApp, Mail, Mensajes, etc.)
  con fallback de descarga si el navegador no la soporta.
- **Escáner (Scan)** con cámara en vivo o fotos de la galería, 100% local:
  - Detecta los bordes de la hoja con tres métodos de respaldo (rectas, segmentación de la hoja y rectas
    relajadas), así funciona también con fondos parecidos al papel o con poca luz.
  - Endereza la perspectiva. Si hay una **esquina doblada**, la ignora y prolonga los lados rectos.
  - **Nivela el texto** midiendo la inclinación de las líneas y **gira la página** si la foto salió de lado
    (también al revés cuando está seguro; si no, no toca nada y queda el botón "Girar 90°").
  - Filtros: Automático (quita sombras), Color original, Escala de grises y **Documento B/N**
    (papel blanco puro y texto negro, estilo CamScanner).
  - **Lupa** al arrastrar una esquina para ajustarla con precisión.
- PWA instalable, con modo claro/oscuro/automático y funcionamiento offline
  una vez cacheada (service worker).

## Editar un PDF

1. En Inicio, toca «Editar PDF» y elige el documento. Si ya tienes un PDF abierto, toca «Editar» en el visor. Usa «Texto» u «Objetos».
2. En «Texto», toca una palabra o un bloque resaltado. Escribe la corrección y toca «Aplicar». En una hoja escaneada, pulsa «OCR» y elige si quieres seleccionar palabras o líneas. Si la capa OCR anterior guarda la línea completa, selecciona «Líneas» para sustituirla.
3. En «Objetos», toca una imagen o gráfico independiente, arrastra el marco para moverlo o usa las flechas del teclado. Usa «−», «+» y «Girar 15°» para ajustar el tamaño y el ángulo. El botón «Deshacer edición PDF» revierte el último cambio.
4. Usa «Guardar PDF» o «Compartir PDF» para exportar la copia. Abrir un documento nuevo o añadir páginas inicia un nuevo historial de deshacer.

[PDFium de EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer) modifica los objetos PDF nativos. El OCR de español e inglés usa [Tesseract.js](https://github.com/naptha/tesseract.js). La primera vez se requiere conexión para descargar estos recursos. El OCR actúa sobre escaneos que tienen una imagen de página independiente. Los logos que forman parte de esa foto requieren una herramienta de recorte y relleno para moverlos por separado. El editor usa una tipografía estándar similar cuando no puede reutilizar la original.

## Privacidad

Todo el procesamiento (lectura de PDF, dibujo, almacenamiento y exportación)
ocurre enteramente en el navegador del usuario. La aplicación no tiene
backend, no usa bases de datos externas y no realiza ninguna petición de
red con datos del usuario.

### Escaneo

- Cuatro detecciones y correcciones de perspectiva independientes: PDF Pro, Nitidoc, Scanic clásico (JS/WASM) y Quadscan (DocAligner y ONNX Runtime Web).
- Comparación de motores a partir de una sola foto y comparación del original recortado contra los ajustes de cada página. El filtro Papel blanco y la mejora automática usan la estimación de iluminación de Scancat.
- Borrador local en IndexedDB, con duplicación sin copiar el archivo de origen, cambio de orden por arrastre o botones, repetición de foto, recorte, filtros individuales y filtro para todas las páginas.
- Un PDF por borrador, con cuatro niveles de calidad y tamaño Automático, Carta, A4 o Legal. El visor existente permite guardar, compartir y editar. Máxima calidad usa JPEG 99 %, con un máximo de 12.5 megapíxeles y 5760 píxeles por lado por entrada para controlar la memoria.
- La cámara integrada pide la máxima resolución de foto fija que el navegador ofrece, con alternativas de cámara del dispositivo y fotograma del vídeo. Los documentos nunca se envían a un servidor. Nitidoc y Quadscan descargan sus dependencias solo cuando se usan por primera vez. El service worker puede guardarlas para uso posterior sin conexión.

[Fuentes y licencias de los motores](vendor/SCANNERS.md)
