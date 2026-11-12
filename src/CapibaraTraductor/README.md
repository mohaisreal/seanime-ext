# CapibaraTraductor para Seanime

Proveedor de manga en español con soporte para varios scans.
El listado conserva los nombres de los capítulos publicados por cada scan.
Cuando un capítulo no tiene nombre, muestra `Capítulo N`.

Instala o actualiza la extensión desde este manifiesto en Seanime:

[manifest.json](https://raw.githubusercontent.com/mohaisreal/seanime-ext/main/src/CapibaraTraductor/manifest.json)

La versión 1.0.2 recupera las URL originales a partir de `ph` y `ls`,
usando la clave temporal del HTML del lector. La extracción se hace con JavaScript
local, sin ejecutar scripts ni WebAssembly de la web. Conserva compatibilidad con
`pg` y `rv`. También procesa los metadatos `lh` de páginas
insertadas, conservando el orden de lectura. Si la respuesta no se puede
decodificar, informa del error para evitar mostrar las imágenes de sustitución.

Abre una ficha de manga y selecciona **CapibaraTraductor** como proveedor.
Para comprobar la corrección puedes usar Mashle con el scan DORAGON NO TENSEI,
capítulo 149. Si un capítulo abierto anteriormente conserva imágenes antiguas,
utiliza la opción del lector para recargar sus páginas.

Comprobaciones:

```powershell
node --test tests/capibara.test.cjs
node --test tests/capibara.live.cjs
node tests/capibara.seanime.cjs http://127.0.0.1:43211
```

La última ejecuta el proveedor en el Playground de Seanime con su motor Goja
y descarga imágenes con su `fetch` nativo.
