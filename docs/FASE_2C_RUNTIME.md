# Fase 2C: punto de autorización de descargas

Estado actual: imagen backend construida y probada, aislamiento corregido y
verificado. Backend y frontends NO iniciados. Las secciones iniciales conservan
el inventario previo a la autorización; el resultado ejecutado está al final.

Actualización posterior: la base principal ya fue preparada con autorización
específica en Fase 2D. Consultar [`FASE_2D_BASE.md`](FASE_2D_BASE.md); las referencias
a base principal vacía en este registro de Fase 2C son históricas.
Este registro corrige las conclusiones demasiado amplias de aislamiento de Fase 2B.

## Reutilización dirigida

- PostgreSQL, Redis y Alpine oficiales locales: no requieren otra descarga.
- BuildKit contiene registros de las cuatro capas de la referencia oficial Node
  `sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5`.
- Los metadatos públicos de esa referencia identifican Node 24.22.3,
  linux/arm64/v8, manifiesto específico
  `sha256:f44b069ce4b5d00cb4f7dff81821a4a6953e3790420040abf300139b1d317c6c`.
  Sus capas comprimidas suman 62.304.621 bytes (59,42 MiB).
  No está registrada como imagen ejecutable. Los registros de caché no prueban
  que pueda materializarse sin transferencias: no se intentó un build que pudiera
  descargar silenciosamente. Se solicitará autorización para resolver solo esta
  identidad y reutilizar las capas disponibles, sin imágenes de otros proyectos.
- Recorrido estático del lockfile: backend + shared + TypeScript + tsc-alias +
  Prisma suman 412 entradas. De sus tarballs solo faltan los dos de Sharp abajo.
  Los tarballs presentes se comprobaron contra su SRI, sin instalar dependencias.

## Las siete ausencias anteriores, precisadas para Alpine arm64

| Paquete | Versión | Falta en caché | Necesario para backend |
| --- | --- | --- | --- |
| `@next/swc-linux-arm64-musl` | 16.3.4 | sí | no |
| `@img/sharp-linuxmusl-arm64` | 0.35.4 | sí | sí |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.3 | sí | sí |
| `@esbuild/linux-arm64` | 0.28.2 | sí | no, build con tsc |
| `@unrs/resolver-binding-linux-arm64-musl` | 1.12.2 | sí | no |
| `@unrs/resolver-binding-wasm32-wasi` | 1.12.2 | sí | no |
| `@napi-rs/wasm-runtime` | 1.2.3 | sí | no |

Las alternativas glibc tampoco sirven como sustituto en Alpine musl.
Los dos tarballs necesarios proceden de registry.npmjs.org; su SRI público
coincide con package-lock.json. Tamaños descomprimidos publicados: Sharp 341.907
bytes y libvips 18.659.008 bytes. HEAD no proporcionó tamaño comprimido; reservar
hasta 19 MiB para ambos, sin presentarlo como medición de transferencia.

Además faltan los motores Linux de Prisma 5.22.0, commit
`605197351a3c8bdd595af2d2a9bc3025bca48ea2`, plataforma
`linux-musl-arm64-openssl-3.0.x`, origen binaries.prisma.sh:

- `libquery_engine.so.node.gz`: 6.941.492 bytes; SHA-256 comprimido
  `cddac785027f0cd45725c5eadc9e1d097a5be138a485db7875ed1c38965f2c1e`.
- `schema-engine.gz`: 7.589.235 bytes; SHA-256 comprimido
  `7d4c321b6d919e360ca05acd20dd99c7a95da11e9d9d3871e30725162f2b58d1`.
  Se reserva para validación de esquema; no es un requisito del proceso servidor.

Reserva condicional para enlazado OpenSSL tras comprobar la base Node:
Alpine v3.24/main/aarch64, `libssl3` y `libcrypto3` 3.5.9-r0,
373.023 y 2.286.800 bytes de paquete según APKINDEX (2,54 MiB juntos).
Descargar solo si faltan o es necesario igualar la versión requerida por libssl3;
verificar integridad con metadatos firmados de Alpine. Sin compiladores ni SDK.

## Reenviador: bloqueo de seguridad confirmado

Inspección de los contenedores WingsLab y sondas efímeras propias con Alpine
local, pull deshabilitado, sin secretos, sin capacidades y filesystem de solo lectura:

- Los seis puertos publicados están vinculados a 127.0.0.1 en el host.
- Sin embargo, `netstat` muestra escuchas comodín `:::3101–3104`, `:::15432`
  y `:::16379`. Los seis puertos son alcanzables tanto desde la red interna
  (172.30.240.30) como desde la red de borde (172.31.240.10).
- El reenviador tiene ruta por defecto e `ip_forward=1`.
- Esto no demuestra acceso de SaDeL, ni se probaron recursos ajenos, pero sí
  contradice la afirmación de acceso exclusivo desde el host. No se considera
  cumplida todavía la política de acceso solo a servicios autorizados.
- Antes de autorizar backend: limitar relés a la interfaz de ingreso, desactivar
  forwarding, cerrar puertos frontend no utilizados y verificar límites desde
  ambas redes con pares propios. Si Docker Desktop requiere una topología o
  firewall adicional, presentar el cambio y cualquier descarga por separado.

## Próxima ejecución, solo después de autorizar descargas

1. Resolver la base Node fijada, reutilizando BuildKit; verificar plataforma y versión.
2. Aprovisionar solo el árbol backend/shared y herramientas necesarias desde caché,
   sin scripts automáticos ni reinstalación del monorepositorio del host.
3. Construir un target exclusivo backend con red de build deshabilitada, fuentes
   permitidas y motores Prisma explícitos. No incluir configuraciones locales ni
   secretos, artefactos Darwin, frontends ni credenciales externas.
4. Probar carga de Sharp/Prisma sin arrancar la aplicación y ejecutar unitarias.
5. Corregir/verificar el borde y probar conectividad desde el namespace previsto
   para backend, sin solicitudes a producción ni modificaciones de firewall host.
6. Verificar identidad y esquema de la base WingsLab elegida; la primaria aún no
   contiene el esquema de negocio, los fixtures están en wingslab_migration_test.
7. Solicitar autorización separada antes de activar flags y arrancar backend.

El primer arranque aprobado usará el servicio explícito `backend` de Compose con
`--no-deps --pull never`, no `up` indiscriminado. Comprobar salud, identidades,
logs sin secretos e integraciones/jobs desactivados; detener solo backend si falla.
Los comandos exactos quedarán fijados tras preparar el target y la topología.

## Resultado ejecutado tras la autorización del lote de 95 MiB

### Descargas reales y reutilización

| Artefacto descargado | Bytes comprimidos |
| --- | ---: |
| `@img/sharp-linuxmusl-arm64@0.35.4` | 122.050 |
| `@img/sharp-libvips-linuxmusl-arm64@1.3.3` | 8.499.072 |
| Prisma query engine aprobado | 6.941.492 |
| Prisma schema engine aprobado | 7.589.235 |
| **Total de artefactos** | **23.151.849 (22,08 MiB)** |

SRI de los tarballs verificado contra el lockfile; SHA-256 de los motores
comprimidos verificado contra los valores fijados arriba. El total cuenta los
artefactos, no overhead TLS ni respuestas pequeñas de metadatos.

Las cuatro capas oficiales Node se materializaron desde BuildKit, sin
transferencia de capas reportada por el build. Se comprobaron sus cuatro diff-IDs
contra la configuración OCI pública fijada. Node 24.22.3 / npm 11.19.1 / Alpine
3.24.4. La base ya incluye `libssl3`, `libcrypto3`, `libstdc++` y `libgcc`:
**ningún APK descargado**. No se sustituyeron versiones ni binarios.

El contexto backend contiene 653 paquetes con SRI verificado: 651 reutilizados de
la caché local y los 2 tarballs aprobados. Esa cifra incluye compilación y Jest;
la imagen final contiene solo los 367 paquetes del árbol de producción, más el
cliente Prisma generado. No se ejecutó npm install/ci ni lifecycle scripts, ni se
modificó node_modules del monorepositorio. El script de staging falla si falta
algún tarball y no tiene código de descarga. Excluye tsx/esbuild y los frontends.

### Corrección del borde

- `edge/start-edge.sh` inicia exclusivamente los relés 15432 y 16379.
- Escuchan exclusivamente en `172.31.240.10`, no en direcciones comodín ni en
  la interfaz interna `172.30.240.30`.
- Publicaciones host: únicamente `127.0.0.1:15432` y `127.0.0.1:16379`.
  Puertos 3101–3104 cerrados, incluido backend hasta nueva autorización.
- Sysctls del namespace edge: IPv4 forwarding=0, IPv6 forwarding=0,
  IPv6 disable=1. Sin privilegios ni capacidades; UID 1000 y filesystem readonly.
- La red exclusiva `wingslab_2b_edge` se recreó con
  `com.docker.network.bridge.enable_icc=false`. Se comprobó previamente que sus
  labels eran WingsLab y que su único endpoint era el propio reenviador.
  PostgreSQL, Redis, la red interna y sus volúmenes no se recrearon.
- No se modificó Docker Desktop globalmente, el firewall macOS ni recursos ajenos.

### Pruebas de red superadas

Primero con Alpine local y luego con la imagen final y su namespace previsto:
IP 172.30.240.21, UID 1000, readonly, cap_drop ALL, no-new-privileges,
sin forwarding y con IPv6 desactivado, igual que el servicio backend preparado.
No se importó su entrypoint ni se lanzó ningún servidor de aplicación.

- PostgreSQL y Redis propios: alcanzables.
- Relés del borde: inaccesibles desde la red interna y desde un peer propio en
  la red de borde (ICC). Tráfico directo entre ambas redes hacia datos: bloqueado.
- Endpoint simulado en otra red Docker: bloqueado por IPv4 y por IPv6; el peer
  se comprobó primero con listeners funcionales en ambas familias.
- Endpoint propio en el host, únicamente en loopback y con control positivo
  desde el host: inaccesible desde el namespace backend mediante
  `host.docker.internal` y gateway interno.
- DNS propio resuelve PostgreSQL; nombre de fixture `.invalid` rechazado.
  No se sondearon dominios o IP de producción.
- Sin ruta IPv4 por defecto, sin forwarding, IPv6 desactivado.
- Desde el host, los dos puertos de datos responden y 3101–3104 están cerrados.
- Los peers y redes temporales propios se eliminaron en bloques finally.

Verificación reproducible:

```bash
python3 scripts/wingslab-verify-network.py
```

### Build y pruebas técnicas

`infrastructure/runtime/Dockerfile.backend` utiliza exclusivamente la base local
materializada y todos sus RUN se ejecutan con `--network=none`. No requiere
descargar frontend Dockerfile, paquetes, compiladores ni imágenes auxiliares.

Se corrigieron dos incompatibilidades de Prisma 5 con aprovisionamiento offline:
su detector de OpenSSL solo busca `/lib` en Alpine, mientras esta base lo ubica en
`/usr/lib`; se añadió un enlace a la biblioteca ya presente. Además, generate
recibe rutas explícitas a ambos motores verificados para evitar el downloader
automático. Los intentos iniciales del downloader fallaron dentro del build sin
red; no descargaron motores adicionales. No se cambió el schema ni la versión.

Resultados:

- Compilación real shared/backend con TypeScript y tsc-alias: pasa.
- Prisma Client 5.22.0 generado offline: pasa.
- Jest Linux/arm64: 3 suites, 11 pruebas herméticas, todas pasan.
- Imagen final readonly y sin red: transformación PNG real con Sharp 0.35.4 /
  libvips 8.18.6 (tarball 1.3.3), carga nativa del motor Prisma y constructor del
  cliente sin conexión: pasan.
- Resolución Fastify/ioredis/shared: pasa. Next/Jest/TypeScript/Prisma CLI ausentes
  de la imagen final. Configuraciones locales y secretos no copiados al contexto.
- Guardas de autorización bloquean runtime. Integraciones externas desactivadas;
  grupos de jobs, incluida facturación, solo admiten selecciones false.
- Montaje readonly de configuración legible por UID 1000: comprobado sin imprimir
  su contenido ni activar flags.

Imagen lista: `wingslab-backend:2c`, Linux/arm64, 453,30 MiB descomprimidos.
Identidad inmutable:
`sha256:38909b02db294ab0ff8b0220cb07cd0ab58f7c8964b21bc34ae47f34d1bd4ebe`.
Está fijada como `WINGSLAB_BACKEND_IMAGE` en el env local ignorado por Git.
El perfil `approved-backend` está separado de los frontends y usa restart=no.
El CMD predeterminado de la imagen es el bloqueo, no el servidor.

Comandos de preparación utilizados (contexto temporal propio, sin secretos):

```bash
# P=/private/var/folders/bp/fw91jby178j6336lpfmmd84m0000gn/T/opencode/wingslab-2c-wad1euux
# Para repetir staging, elegir un destino NUEVO; no sobreescribir contextos.
python3 scripts/wingslab-stage-backend.py "$P/backend-context-new" "$P/downloads"
docker --context desktop-linux buildx build --platform linux/arm64 \
  --network none --pull=false --load --provenance=false \
  -t wingslab-backend:2c -f infrastructure/runtime/Dockerfile.backend \
  "$P/backend-context-v4"

docker --context desktop-linux run --rm --pull=never --network none \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,uid=1000,gid=1000 \
  --cap-drop=ALL --security-opt=no-new-privileges:true -i \
  wingslab-backend@sha256:38909b02db294ab0ff8b0220cb07cd0ab58f7c8964b21bc34ae47f34d1bd4ebe \
  node - < scripts/wingslab-verify-runtime.cjs
```

### Estado de datos y límite de autorización

Una sonda técnica de la imagen final, sin servidor ni jobs, comprobó en modo
lectura los UUID de PostgreSQL y Redis, su coincidencia con la configuración y
el rol SQL sin superusuario, CREATEDB ni CREATEROLE. Redis conserva solo su marcador.

**La configuración backend todavía apunta a `wingslab_local`, cuyo public tiene
0 tablas de negocio.** El baseline y los fixtures de Fase 2B están en la base
desechable `wingslab_migration_test`. No se cambiaron destinos ni se ejecutaron
migraciones o seeds durante esta preparación. Antes de pruebas funcionales se
debe preparar la base primaria con el baseline ya probado y fixtures sintéticos,
previa confirmación del alcance. No confundir imagen lista con datos listos.

No existe contenedor de servicio backend ni frontend. Los flags runtime y
networkVerified siguen false. No se hicieron despliegues, publicaciones, commits
ni pushes. El primer arranque sigue requiriendo autorización separada, así como
habilitar exclusivamente la publicación 3101 en el borde y volver a probarla.
No ejecutar todavía:

```bash
docker --context desktop-linux compose --project-name wingslab-2b \
  --file infrastructure/runtime/compose.yml \
  --env-file infrastructure/runtime/runtime.env --profile approved-backend \
  up -d --no-deps --pull never backend
```
