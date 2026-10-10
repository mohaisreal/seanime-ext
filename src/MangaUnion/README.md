# MangaUnion para Seanime

Proveedor de manga, manhwa y manhua de [MangaUnion](https://mangaunion.com/),
con contenido en **italiano** (`it`). Implementa el contrato de la
[wiki de proveedores de manga](https://seanime.gitbook.io/seanime-extensions/content-providers/manga-provider).

## Instalar

Importa `src/MangaUnion/mangaunion.json` como extensión local en Seanime, o copia
ese archivo a la carpeta `extensions` del directorio de datos de Seanime y recarga
las extensiones. Selecciona **MangaUnion** como proveedor.

El manifiesto incluye el código completo. **No necesita servicios auxiliares,
Node.js, configuración de puertos ni cuentas de usuario para funcionar.**

## Lectura y limitaciones

La API entrega páginas `.bin` cifradas con ChaCha20, una clave por capítulo y un
nonce por página. La extensión descarga esos bytes mediante `fetch().body`,
los descifra en TypeScript y entrega imágenes incorporadas como
`data:image/webp;base64,...`, con cabeceras vacías.

El [lector de Seanime](https://github.com/5rahim/seanime/blob/main/seanime-web/src/app/%28main%29/manga/_lib/handle-manga-utils.ts)
utiliza directamente la URL cuando las cabeceras están vacías. Esto permite leer
las imágenes sin un servidor adicional. El cifrado y la conversión a base64 no
utilizan APIs de Node ni APIs de navegador que falten en Goja.

**El descargador de Seanime no admite estas páginas incorporadas.** Su
[descargador](https://github.com/5rahim/seanime/blob/main/internal/manga/downloader/chapter_downloader.go)
solicita cada URL mediante HTTP, por lo que los capítulos cifrados son compatibles
con la lectura, pero no con la descarga a la biblioteca. El cálculo automático de
dimensiones para doble página usa la misma ruta HTTP y también puede fallar.
El formato de proveedores de la wiki no ofrece opciones para desactivar esos botones.

Se necesita una versión de Seanime que exponga el cuerpo binario de la respuesta
como `body`, como hace su [implementación de fetch](https://github.com/5rahim/seanime/blob/main/internal/goja/goja_bindings/fetch.go).
Si no está disponible, la extensión devuelve un error explícito.

Todas las imágenes del capítulo se descargan y descifran antes de abrirlo, con
un máximo de ocho solicitudes simultáneas. La conversión binaria y base64 utilizan
las funciones nativas de Seanime cuando están disponibles; el descifrado procesa
palabras de 32 bits para reducir el trabajo de Goja.
El consumo de memoria y el tiempo de apertura aumentan
con el tamaño del capítulo; base64 añade aproximadamente un tercio al tamaño de las
imágenes. Seanime guarda esas imágenes incorporadas en su caché de páginas.

Si la API entrega imágenes sin cifrar, la extensión conserva las URLs HTTP normales.

## Endpoints comprobados

Base: `https://api.mangaunion.com/api/v1`.

| Operación | Ruta | Campos usados |
| --- | --- | --- |
| Búsqueda | `/manga?q=One%20Piece&limit=25&page=1` | `data[].slug`, `title`, `titleEng`, `titleRomaji`, `coverImage`, `year` |
| Capítulos | `/manga/one-piece/chapters?limit=100&page=1&order=asc` | `data[].number`, `title`, `releaseDate`, `meta.totalPages` |
| Lector | `/manga/one-piece/chapters/1` | `chapter.pages[].url`, `n`, `chapter.enc`, `pageCount` |
| Lector decimal | `/manga/senpai-ga-urusai-kouhai-no-hanashi/chapters/180.5` | El mismo formato |
| Capítulo largo | `/manga/berserk/chapters/0.01` | 115 páginas cifradas |

El ID de un manga es su slug; el ID de un capítulo es `slug|número`.
Se recorren todas las páginas de capítulos y se ordenan por número ascendente,
conservando el capítulo cero y los decimales. La búsqueda devuelve hasta 25 resultados
y títulos inglés y romaji como sinónimos. Los errores HTTP y respuestas incompletas
se comunican sin devolver listas parciales.

## Validación del 10 de octubre de 2026

- Búsqueda de One Piece: 25 resultados.
- One Piece: **1.197 capítulos**, recuperados en **12 páginas de API**.
- One Piece, capítulo 1: **25 imágenes incorporadas**.
- Senpai ga Urusai Kouhai no Hanashi, capítulo 180.5: **14 imágenes incorporadas**.
- Berserk, capítulo 0.01: **115 imágenes incorporadas**.
- **34.764.310 bytes** descifrados con TypeScript y comparados byte por byte con
  ChaCha20 de OpenSSL; todas las páginas tienen firma WebP válida.
- Diez pruebas locales: búsqueda, paginación, decimales, base64, descifrado,
  orden con descargas concurrentes, errores y páginas sin cifrar.
  No se inicia ningún servicio en las pruebas.
- Comprobación TypeScript en modo estricto.
- Una página real de 464.682 bytes comprobada en Goja, con transpilación ES2018 y
  respuesta binaria `[]byte`, comparando el SHA-256 con el descifrado independiente.

La implementación optimizada también se ejecutó dentro del Playground de Seanime 3.10.3:
las 115 páginas de Berserk 0.01 tardaron **33,97 segundos**, frente a los
**80,03 segundos** registrados con la versión anterior. Todas las imágenes
devueltas por Seanime coinciden byte por byte con la comprobación independiente.
Se comprobó en el lector web del mismo servidor que las primeras tres imágenes
cargan con dimensiones de 725 × 1024. La primera apertura de capítulos largos
todavía requiere esperar a su procesamiento completo; las siguientes utilizan
la caché de Seanime. La aplicación Denshi no se controló durante esta prueba.

Las pruebas de integración usan los endpoints reales y una adaptación de `fetch`
que reproduce el cuerpo binario y `json()` síncrono de Seanime.

```powershell
node --test tests/mangaunion.test.cjs
node --test tests/mangaunion.live.cjs
```

Solo estas herramientas de desarrollo usan Node.js 22.13 o posterior.
La segunda orden descarga y descifra las imágenes reales de los tres capítulos.

## Actualizar o publicar

Después de modificar `main.ts` o `manifest.json`, regenera el manifiesto local:

```powershell
node src/MangaUnion/build.cjs
```

`manifest.json` contiene las URLs de publicación de este repositorio en GitHub.
Estarán disponibles cuando publiques los archivos. `mangaunion.json` incluye el
payload y no depende de esas URLs ni busca actualizaciones remotas.
