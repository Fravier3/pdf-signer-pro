# Nitidoc en PDF Pro

Motor original de [Nitidoc](https://github.com/santiagoisra/nitidoc), por santiagoisra.
Versión upstream [6028f5d3a5759233e31c3135a1ef893c23739bf3](https://github.com/santiagoisra/nitidoc/tree/6028f5d3a5759233e31c3135a1ef893c23739bf3).
Motor y fuentes bajo [GNU AGPL-3.0-or-later](LICENSE.txt).

El código fuente correspondiente al worker distribuido está en [source](https://github.com/Fravier3/pdf-signer-pro/tree/main/vendor/nitidoc/source).
[Este repositorio](https://github.com/Fravier3/pdf-signer-pro) incluye el cliente que implementa el protocolo de mensajes del motor y la aplicación que lo incorpora.

Para reproducir el worker estático desde el directorio `vendor/nitidoc`:

```sh
npx --yes esbuild@0.28.2 source/src/features/scanner/worker/opencv.worker.ts \
  --bundle --format=iife --target=safari16 --minify-whitespace \
  --tsconfig=source/tsconfig.json --outfile=engine.js \
  --banner:js='/* Nitidoc by santiagoisra · AGPL-3.0-or-later · Corresponding source: vendor/nitidoc/source and LICENSE.txt */'
```

[OpenCV.js 4.10.0-release.1](https://www.npmjs.com/package/@techstark/opencv-js/v/4.10.0-release.1)
usa la [licencia Apache 2.0](OpenCV-LICENSE.txt). La descarga original se comprueba con SHA-256. Sus fuentes están en
[OpenCV](https://github.com/opencv/opencv/tree/4.10.0) y el [paquete de TechStark](https://github.com/TechStark/opencv-js).
