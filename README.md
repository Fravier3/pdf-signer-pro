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
- PWA instalable, con modo claro/oscuro/automático y funcionamiento offline
  una vez cacheada (service worker).

## Privacidad

Todo el procesamiento (lectura de PDF, dibujo, almacenamiento y exportación)
ocurre enteramente en el navegador del usuario. La aplicación no tiene
backend, no usa bases de datos externas y no realiza ninguna petición de
red con datos del usuario.
