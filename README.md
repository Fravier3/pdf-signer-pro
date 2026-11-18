# PDF Signer Pro

Aplicación web (PWA) para abrir PDFs, insertar firmas (PNG o dibujadas a mano),
moverlas / escalarlas / rotarlas y exportar un nuevo PDF con las firmas
incrustadas de forma permanente. **100% local**: ningún archivo ni firma
sale nunca de tu dispositivo.

## ⚠️ Antes de publicar: 1 paso obligatorio

Este proyecto necesita 2 librerías de terceros (PDF.js y pdf-lib) que **no
pude incluir en el paquete** por no tener acceso a internet en el entorno
donde generé este código. Lee **`js/lib/LEEME_IMPORTANTE.txt`** — son 3
archivos para descargar y copiar en `js/lib/`, toma 2 minutos. Todo lo
demás (HTML, CSS, JS de la app, íconos, manifest, service worker) está
100% completo y no requiere ningún cambio.

## Publicar en GitHub Pages

1. Añade los 3 archivos de librerías indicados en `js/lib/LEEME_IMPORTANTE.txt`.
2. Sube todo el contenido de esta carpeta a un repositorio de GitHub.
3. En el repositorio: **Settings → Pages → Source → rama principal (root)**.
4. Abre la URL que te da GitHub Pages. Desde el móvil, usa "Añadir a
   pantalla de inicio" (iPhone) o "Instalar aplicación" (Android) para
   instalarla como app nativa.

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
