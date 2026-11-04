# Custom Manga Metadata

Editor de metadata local de Manga para Seanime, inspirado en el plugin **Custom Anime Metadata** de Kaktus instalado en la aplicación.

En una ficha de Manga, pulsa **Editar metadata**, cambia los campos que necesites y pulsa **Guardar**. Los campos vacíos y las opciones **AniList (original)** mantienen el valor original. **Restaurar AniList** elimina todas las personalizaciones de esa obra y vuelve a cargar sus datos originales.

Permite editar títulos Romaji/inglés/nativo, sinopsis, URL de portada/banner, formato (Manga, One Shot o Novel), estado, capítulos, volúmenes, puntuación media, fechas, géneros y títulos alternativos. Las listas se escriben separadas por comas. Los números deben ser enteros no negativos; la puntuación va de 0 a 100. Las fechas deben existir y usar `AAAA-MM-DD`.

Los cambios persisten por ID de Manga en el almacenamiento del plugin y se aplican a las fichas y a la biblioteca. No modifica el catálogo remoto de AniList ni tu progreso de lectura. Cambiar capítulos o volúmenes modifica la metadata, no crea capítulos en el proveedor. El título principal respeta el idioma preferido de AniList; si usas Alternative Titles, este plugin puede elegir otro idioma para mostrarlo.

## Instalación de la versión 1.0.0

En **Extensiones → Add extensions**, instala este manifiesto:

```text
https://raw.githubusercontent.com/mohaisreal/seanime-ext/main/src/CustomMangaMetadata/manifest.json
```

La versión publicada no utiliza `isDevelopment`. Para generar el JSON instalable con el código incluido y copiar la versión estable a Seanime desde este checkout:

```powershell
node src/CustomMangaMetadata/build.cjs --install --replace
```

Recarga el plugin desde Extensiones después de sustituir una copia instalada.

## Desarrollo opcional

```powershell
node src/CustomMangaMetadata/build.cjs --install-dev
```

Solo esta opción genera un manifiesto de desarrollo con `isDevelopment: true` y `payloadURI` apuntando al `main.ts` de este checkout. También copia ese manifiesto a `%APPDATA%/Seanime/extensions/custom-manga-metadata.json`. Si ya existe, añade `--replace` para sustituirlo deliberadamente. El manifiesto de desarrollo se excluye de Git. Si es una extensión nueva, reinicia Seanime una vez para que descubra el archivo; después puedes recargar el plugin desde Extensiones sin reiniciar la aplicación.

La compilación por defecto genera únicamente el JSON estable, sin activar desarrollo:

```powershell
node src/CustomMangaMetadata/build.cjs
```

Los hooks y el registro de UI se ejecutan en ámbitos aislados de Seanime. Por eso las utilidades viven dentro de `$shared.define` y los callbacks acceden a ellas con `$shared.use`. Se reutilizan los tipos de `AniListPlusOne` y se añade la declaración del API `$shared` disponible en el runtime instalado.

## Validación

```powershell
node --test tests/custom-manga-metadata.test.cjs
npm.cmd exec --yes --package=typescript -- tsc --noEmit --skipLibCheck --target es2020 src/CustomMangaMetadata/main.ts
```

Las pruebas cubren validación, valores cero, idioma preferido, persistencia, aislamiento de hooks, selección por ID y registro del editor en un ámbito separado.

Referencias: [API Manga de Seanime](https://seanime.gitbook.io/seanime-extensions/plugins/ui/other/manga), [API AniList](https://seanime.gitbook.io/seanime-extensions/plugins/apis/anilist) y [Custom Anime Metadata de Kaktus](https://github.com/Kaktusmann/seanime-extension/tree/main/src/custom-anime-metadata).
