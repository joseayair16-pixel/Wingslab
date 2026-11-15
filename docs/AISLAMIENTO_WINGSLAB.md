# WingsLab — aislamiento técnico: Fases 1, 2A y preflight 2B

> **Estado vigente: Fase 2B detenida antes de crear recursos.** Ver sección 10:
> Docker local accesible, imágenes esenciales pendientes y autorización de creación
> todavía NO concedida. No se han iniciado aplicaciones ni creado secretos.
> La sección 9 describe la preparación de 2A y reemplaza las
> instrucciones de configuración y las limitaciones corregidas de las secciones
> 1–8, que se conservan como registro histórico de Fase 1. No iniciar servicios.
> Las verificaciones de red, identidades, builds y comportamiento siguen pendientes
> de autorización y ejecución controlada en Fase 2B.

## Estado y alcance — registro histórico de Fase 1

**Ejecución local NO autorizada. Aislamiento completo NO demostrado.**

Se implementan barreras de configuración y bloqueos conservadores. No se han
ejecutado servidores, migraciones, semillas, suites de aplicación, Android,
contenedores ni herramientas de despliegue. No se ha contactado ningún servicio.
No se han creado recursos, rotado credenciales, hecho commits ni modificado SaDeL.

Los cambios se limitan a archivos regulares con destino dentro de WingsLab.
Los enlaces de entorno, archivos Firebase, firmas, respaldos, APK y compilados
heredados se conservan; no se usan como fuente de configuración ni se copian.

## 1. Riesgos iniciales y clasificación

- **Crítico:** los cuatro frontends redirigían `/api` al backend Railway de SaDeL;
  varios sockets y cargas del lado servidor tenían el mismo fallback.
- **Crítico:** el arranque backend activaba trabajos con cambios en datos,
  facturación, mensajes, notificaciones y limpieza de archivos.
- **Crítico:** el arranque Railway aplicaba migraciones automáticamente; existían
  scripts de reset, borrado R2 y publicación APK con capacidad de escritura.
- **Alto:** Android usaba dominios, proyecto Firebase e identidades de SaDeL y
  tenía acceso a firmas heredadas.
- **Alto:** variables heredadas, enlaces `.env.local`, configuraciones Vercel y
  Docker podían reutilizar servicios de SaDeL o servicios locales de otro proyecto.
- **Medio:** monitor GitHub, imágenes, mapas, enlaces y metadatos remotos heredados.

### Enlaces inspeccionados sin seguirlos

Los cuatro `packages/web-{admin,restaurant,customer,driver}/.env.local` apuntan a
`../../.env.local`. Se conservaron sin leer el destino, incluso si está ausente.
El preflight detecta enlaces colgantes mediante `lstat` y bloquea el arranque.

### Referencias históricas frente a operativas

README, documentación anterior, historial Git y `.env.example` son material
heredado, no configuración aprobada. No usar las instrucciones antiguas.
El monitor SaDeL sigue conservado pero su job está deshabilitado con `if: false`.
Railway y Vercel mantienen archivos de integración, ahora con builds bloqueados.
Los IDs de `.vercel`, Firebase, package names y firmas Android siguen pendientes:
no son prueba de aislamiento ni deben reutilizarse.

## 2. Cambios implementados

### Configuración frontend

- Política central en `config/wingslab.cjs` y accesores tipados en
  `packages/shared/src/wingslab-config.ts`.
- Solo orígenes explícitos `http://127.0.0.1` y puertos WingsLab: backend 3101,
  admin 3100, restaurante 3102, comensal 3103, repartidor 3104.
- Proxies locales en desarrollo y build, sockets sin fallback y metadatos sin
  dominios productivos predeterminados. No se infieren dominios del navegador.
- Configuración ausente o no permitida provoca error, sin sustitución silenciosa.
- CSP restringe conexiones, imágenes, scripts y otros recursos del navegador al
  entorno local. Mapas, fuentes e imágenes externas pueden quedar indisponibles:
  esto es intencional hasta aprobar cada integración.
- Preflight npm ANTES de Next.js: rechaza `.env*` operativos y enlaces heredados
  sin abrirlos. Las plantillas terminadas en `.example` no se cargan.
- `start` permanece bloqueado para no ejecutar compilaciones antiguas.

### Backend

- Ya no descubre ni abre archivos `.env`; exige proceso limpio y variables
  `WINGSLAB_*` nuevas. Rechaza variables heredadas de conexiones y proveedores.
- PostgreSQL restringido a loopback:55433, usuario/base `wingslab_local`;
  Redis a loopback:56379, usuario `default`, DB 0 y contraseña obligatoria.
- JWT y cifrado requieren valores distintos, no placeholder y de al menos
  32 caracteres. La procedencia y aleatoriedad se deberán comprobar al generarlos.
- Prisma usa `WINGSLAB_DATABASE_URL` en el schema, con datasource explícito en el
  cliente central. Esto no reemplaza la revisión de identidad del servidor real.
- Backend escucha solo en loopback y fija CORS a los cuatro orígenes locales.
- Trabajos desactivados por defecto; solicitarlos explícitamente produce error.
- Firebase se bloquea ANTES de abrir cuentas de servicio o inicializar Admin SDK.
- WhatsApp, SMS, correo, FCM, VAPID, R2 e IA permanecen cerrados en código;
  una variable de entorno no permite habilitarlos en esta fase.
- Comandos de pruebas quedan bloqueados hasta revisar suites y entorno.

### Administración, despliegue y Docker

- Scripts administrativos versionados protegidos por importación de un bloqueo
  previo a clientes/operaciones; los scripts destructivos NO aceptan `--confirm`
  como autorización suficiente.
- **No hay ruta habilitada para destrucción ni publicación.** Antes de reabrirlas
  hay que implementar y probar comprobación real de identidad y autorización
  específica. No se simula esa comprobación con un nombre o variable declarativa.
- Arranque Railway termina antes de migrar. Builds Railway/Vercel y arranque del
  contenedor backend bloqueados; jobs CI y monitor deshabilitados.
- Compose heredado: proyecto/contenedores en cuarentena, servicios fuera del
  perfil predeterminado y entrypoints que abortan. Los comandos npm Docker se
  bloquean. No se han tocado contenedores ni volúmenes existentes.
- Nueva plantilla Docker exclusiva para PostgreSQL/Redis, puertos loopback,
  contraseñas obligatorias nuevas, red interna y volúmenes WingsLab separados.
- Contexto Docker excluye firmas, respaldos, Firebase, Vercel, entornos y dist.

### Android

URLs fuente y assets sustituidas por `https://wingslab-disabled.invalid`, dominio
reservado sin servicio real. Scripts npm y configuración Gradle abortan.
No se han firmado, generado, instalado ni publicado APK. Los APK ya existentes
NO quedan corregidos por estos cambios: no instalarlos ni distribuirlos.

Pendientes por cliente:

| Cliente | Identificador heredado | Identidad nueva propuesta, no registrada |
| --- | --- | --- |
| Comensal | `app.sadel.comensal` | `app.wingslab.customer` |
| Restaurante | `app.sadel.restaurant` | `app.wingslab.restaurant` |
| Repartidor | `app.sadel.driver` | `app.wingslab.driver` |

Confirmar identificadores antes de cambiarlos; migrar applicationId, namespace,
paquetes Java, recursos, autoridades y configuraciones Capacitor de forma coherente.
Crear Firebase WingsLab y sus tres registros Android; instalar solamente archivos
descargados del proyecto nuevo. No inventar `google-services.json`.
Crear firmas nuevas y almacenamiento seguro, eliminar fallbacks a firmas SaDeL
al reabrir Gradle. Revisar `SaDelMessagingService`, `OrderAlarmService`, permisos,
canales, registro/revocación FCM y la lógica Web Push con dispositivos de prueba.

## 3. Configuración pendiente y recursos nuevos

Usar exclusivamente `.env.wingslab.example` como inventario preparatorio. Es una
plantilla sin autorización ni secretos utilizables; no copiar el viejo `.env`.
`NEXT_PUBLIC_SITE_URL` debe variar por proceso/frontend. Los archivos `.env`
automáticos siguen prohibidos; diseñar un lanzador de entorno explícito antes de
dar instrucciones de arranque. No se ha creado aún ese lanzador ni un entorno real.

Recursos pendientes, siempre exclusivos y con permisos mínimos:

1. PostgreSQL, Redis, usuarios, contraseñas, volúmenes e identidad local verificada.
2. Claves nuevas JWT/cifrado y registro privado de su procedencia.
3. Repositorio GitHub independiente tras escaneo integral del historial.
4. Proyectos Railway/Vercel separados, sin conexión automática al original.
5. Firebase y registros Android nuevos, cuentas de servicio mínimas y firmas nuevas.
6. R2/bucket y permisos nuevos; WhatsApp/número/webhook de pruebas, correo/SMS
   sandbox, VAPID y Google Maps propios, solo cuando se aprueben individualmente.

## 4. Límites y riesgos pendientes

- No se instaló una frontera real de red. CSP y validaciones no sustituyen firewall,
  sandbox ni controles de egreso del proceso/host.
- Un puerto local puede estar ocupado por otro servicio o túnel. Nombre de base,
  usuario y puerto no prueban identidad. Verificar propietario, instancia y un
  marcador exclusivo antes de habilitar acceso, incluso lectura.
- Los enlaces de entorno aún presentes bloquean deliberadamente la ejecución.
  Su retirada/reubicación requiere decisión explícita del usuario, conservando
  información; no debe abrirse ni modificarse el respaldo externo.
- Se conservan material ignorado, compilados, APK, claves, dump, Firebase y vínculos
  Vercel. Ejecutarlos directamente o eludir los comandos protegidos NO es seguro.
- Los guards no son una frontera contra quien edite código o ejecute CLIs
  directamente (`npx prisma`, Docker, Vercel, Railway, Firebase o scripts ignorados).
- No se efectuó escaneo completo de secretos históricos ni revisión de dependencias.
  No publicar el repositorio hasta cerrar ese control.
- La cadena de migraciones no es reproducible sobre base vacía según el CI
  heredado; requiere baseline/reparación revisada, solo en una base desechable.
- Las suites anteriores necesitarán adaptar variables, puertos y mocks; no están
  validadas tras estos cambios. Tampoco se ejecutaron compilaciones ni type-check.
- Mapas, recursos remotos y enlaces generados con datos necesitan revisión dinámica;
  no importar datos SaDeL, contactos reales ni suscripciones push.
- Cualquier rotación necesaria de SaDeL se coordina fuera de esta tarea; nunca
  revocar o cambiar sus credenciales como efecto secundario del aislamiento.

## 5. Pruebas de seguridad aún necesarias

Tras autorización separada, y primero sin red externa:

1. Comprobar que faltan autorizaciones por defecto y los arranques abortan sin leer
   enlaces ni abrir conexiones; también con `.env` colgantes o externos.
2. Casos negativos: destinos SaDeL, hosts externos, localhost ambiguo, credenciales
   heredadas, placeholders, URLs malformadas y configuración ausente.
3. Verificar que `enableJobs: true`, proveedores con credenciales presentes,
   migraciones, reset `--confirm`, borrado R2 y publicación APK siguen bloqueados.
4. Captura de red que demuestre cero tráfico a SaDeL y a proveedores no aprobados.
5. Crear y verificar identidad de servicios desechables exclusivos; comprobar
   puertos, procesos, volúmenes, usuarios, bases y ausencia de túneles.
6. Revisar sesiones, caches, service workers y dispositivos usando perfil nuevo.
7. Validar schema/baseline, TypeScript, CSP y suites herméticas sin permitir egreso.
8. Validar separación Android completa antes de permitir cualquier build.

## 6. Procedimiento de autorización local

1. Revisar diff y este documento; mantener despliegues y proveedores desactivados.
2. Escanear secretos/historial y resolver material heredado sin borrado automático.
3. El usuario autoriza expresamente cómo retirar los enlaces y vínculos heredados.
4. Aprobar sandbox/firewall y lista de egreso; verificar que no hay credenciales
   SaDeL en shell, IDE, CI, agentes, contenedores o almacenes automáticos.
5. Aprobar la creación de recursos locales exclusivos y comprobar identidad real.
6. Generar secretos nuevos sin imprimirlos, configurar un lanzador explícito y
   adaptar `NEXT_PUBLIC_SITE_URL` por proceso. No habilitar proveedores externos.
7. Solo tras estas evidencias, el responsable puede permitir el token local
   `WINGSLAB_LOCAL_AUTHORIZED=wingslab-local-reviewed` en un proceso limpio con
   `WINGSLAB_ENVIRONMENT=local`. El token es un consentimiento, NO una prueba de
   identidad ni una credencial de seguridad; no basta por sí solo para autorizar.
8. Primera ejecución individual bajo observación de red, nunca `npm run dev`
   masivo como primera comprobación. Detener ante cualquier destino inesperado.

La transformación funcional de SaDeL a WingsLab queda fuera de esta fase y solo
puede comenzar tras demostrar aislamiento con estas verificaciones y aprobación.

## 7. Archivos afectados

El inventario exacto se incluye a continuación; no incluye archivos conservados
sin cambios (enlaces, secretos, respaldos ni artefactos históricos).

```text
.dockerignore
.env.wingslab.example
.github/workflows/ci.yml
.github/workflows/uptime.yml
.gitignore
README.md
apps/customer-android/android/app/build.gradle
apps/customer-android/android/app/src/main/assets/capacitor.config.json
apps/customer-android/capacitor.config.ts
apps/customer-android/package.json
apps/driver-android/android/app/build.gradle
apps/driver-android/android/app/src/main/assets/capacitor.config.json
apps/driver-android/capacitor.config.ts
apps/driver-android/package.json
apps/restaurant-android/android/app/build.gradle
apps/restaurant-android/android/app/src/main/assets/capacitor.config.json
apps/restaurant-android/capacitor.config.ts
apps/restaurant-android/package.json
config/wingslab.cjs
docs/AISLAMIENTO_WINGSLAB.md
infrastructure/docker/Dockerfile.backend
infrastructure/docker/docker-compose.wingslab.example.yml
infrastructure/docker/docker-compose.yml
infrastructure/scripts/start-backend.sh
package.json
packages/backend/create-admin.ts
packages/backend/fix-restaurant.js
packages/backend/get-restaurant.js
packages/backend/package.json
packages/backend/prisma/schema.prisma
packages/backend/query_restaurant.js
packages/backend/railway.json
packages/backend/scripts/migrate-categories.ts
packages/backend/socket-repro.mjs
packages/backend/src/app.ts
packages/backend/src/config/blocked-operation.ts
packages/backend/src/config/database.ts
packages/backend/src/config/env.ts
packages/backend/src/config/isolation.ts
packages/backend/src/config/redis.ts
packages/backend/src/index.ts
packages/backend/src/scripts/add-store-categories.ts
packages/backend/src/scripts/check-db.ts
packages/backend/src/scripts/check_db.ts
packages/backend/src/scripts/clear-r2-bucket.ts
packages/backend/src/scripts/create-admin.ts
packages/backend/src/scripts/create-demo-settlement.ts
packages/backend/src/scripts/create-test-customer.ts
packages/backend/src/scripts/list-billing-status.ts
packages/backend/src/scripts/release-customer-app.ts
packages/backend/src/scripts/release-restaurant-app.ts
packages/backend/src/scripts/reset-production-data.ts
packages/backend/src/scripts/run-billing-overdue-check.ts
packages/backend/src/scripts/seed-billing-demo.ts
packages/backend/src/scripts/seed-platform-categories.ts
packages/backend/src/scripts/seed-store-categories.ts
packages/backend/src/scripts/setup-test-overdue.ts
packages/backend/src/scripts/test-push.ts
packages/backend/src/scripts/test-whatsapp-messages.ts
packages/backend/src/scripts/test-whatsapp.ts
packages/backend/src/services/ai-image.service.ts
packages/backend/src/services/email.service.ts
packages/backend/src/services/fcm.service.ts
packages/backend/src/services/notification.service.ts
packages/backend/src/services/sms.service.ts
packages/backend/src/services/storage.service.ts
packages/backend/src/services/whatsapp.service.ts
packages/backend/src/utils/customer-web.ts
packages/backend/test-api.ts
packages/backend/test-auto-assign.js
packages/backend/test-db.ts
packages/backend/test_prisma.js
packages/backend/test_prisma.ts
packages/shared/src/index.ts
packages/shared/src/wingslab-config.ts
packages/web-customer/next.config.js
packages/web-customer/package.json
packages/web-customer/src/app/layout.tsx
packages/web-customer/src/app/page.tsx
packages/web-customer/src/app/restaurantes/[restaurantId]/layout.tsx
packages/web-customer/src/app/restaurantes/[restaurantId]/page.tsx
packages/web-customer/src/app/robots.ts
packages/web-customer/src/app/sitemap.ts
packages/web-customer/src/components/DriverArrivalModal.tsx
packages/web-customer/vercel.json
packages/web-driver/next.config.js
packages/web-driver/package.json
packages/web-driver/src/app/page.tsx
packages/web-driver/vercel.json
packages/web-restaurant/next.config.js
packages/web-restaurant/package.json
packages/web-restaurant/src/app/page.tsx
packages/web-restaurant/vercel.json
railway.json
scripts/blocked-operation.cjs
scripts/local-preflight.cjs
vercel.json
```

Los tres `assets/capacitor.config.json` están ignorados por Git: fueron modificados
localmente, además de sus fuentes versionadas. No hacer `cap sync` para regenerarlos
hasta completar la separación Android y retirar el bloqueo mediante revisión.

## 8. Validación estática realizada

- `git diff --check`: sin errores de whitespace.
- 100 archivos afectados comprobados como regulares y dentro de WingsLab;
  inventario contrastado con Git y los tres assets ignorados, sin discrepancias.
- 89 archivos JSON/YAML/JavaScript/TypeScript analizados sin evaluar módulos:
  cero errores sintácticos. `bash -n` del script de arranque también pasó.
- Invariantes estáticas: proxies centralizados; preflight en los cuatro frontends;
  sin hosts productivos heredados en código operativo web/Capacitor examinado;
  scripts administrativos versionados protegidos; reset/R2 bloqueados al inicio;
  Gradle y los cinco jobs GitHub bloqueados.

Esto NO acredita compilación, corrección de tipos, ejecución de guards ni aislamiento
dinámico. No se ejecutó código de aplicación ni se contactaron servicios externos.

## 9. Fase 2A — correcciones implementadas

### 9.1 Enlaces y conservación de materiales

Se verificó con `lstat` que las cuatro entradas `.env.local` de admin, restaurante,
comensal y repartidor eran enlaces simbólicos con destino textual EXACTO
`../../.env.local`. Solo después se retiraron con `unlink`, sin seguir el destino.
No se abrió ni modificó ningún respaldo externo. Estas son las únicas eliminaciones.

Se conservan APK, firmas, dump, compilados, archivos Firebase, vínculos Vercel,
scripts ignorados y el historial. NO se ejecutaron ni trasladaron. Fuera del
runtime preparado continúan siendo material potencialmente peligroso.

### 9.2 Configuración explícita y separación de responsabilidades

- `packages/shared/src/wingslab-policy.js` es la única implementación de validación
  de orígenes y destinos; la consumen CJS, backend y accesores del navegador.
- Plantillas canónicas: `config/wingslab.local.example.json` (backend) y
  `config/wingslab.frontend.example.json` (sin secretos de backend).
- No se crearon sus equivalentes `.local.json`, secretos, UUID real ni autorizaciones.
  Todos los permisos de las plantillas están en `false` y los secretos, vacíos.
- El lector acepta solo `config/wingslab.local.json`, archivo regular interno y
  sin enlaces. El montaje de cada frontend suministrará su configuración pública
  bajo ese nombre dentro del contenedor, sin acceso a las claves del backend.
- El lanzador construye una allowlist de variables desde esa configuración, sin
  copiar `process.env`, proxies, `NODE_OPTIONS`, credenciales cloud o archivos `.env`.
  El entorno del proceso padre/imagen también deberá revisarse en 2B.
- La telemetría Next y los avisos de actualización Checkpoint quedan desactivados
  en el entorno construido; npm usa modo offline sin audit/fund en el build.
- Cada frontend recibe su rol y URL explícitamente; no se deduce del directorio.
  El launcher admite build/start de un rol, no inicia todos los procesos a la vez.
- `NODE_ENV=production` queda permitido como modo de build local; NO autoriza ni
  identifica infraestructura. La autorización es independiente y no prueba por
  sí sola que exista una barrera física de red.
- El runtime optimizado también usa `NODE_ENV=production`. La simulación OTP no
  depende de ese valor ni de `ALLOW_MOCK_OTP_IN_PROD`: requiere modo hermético o
  configuración local ya inicializada e identidad verificada. No envía correo/SMS.
- `parseBackendConfiguration` es pura; `loadEnvironment` es explícita; los clientes
  son diferidos; el arranque identifica los servicios antes de abrir el puerto.
- Las importaciones ya no cargan `.env`, construyen Prisma ni inicializan Redis.
  En modo hermético Prisma ofrece métodos estables que exigen mocks y Redis es
  exclusivamente en memoria. No existe fallback a un cliente real durante tests.

### 9.3 Almacenamiento y regresiones funcionales

La fachada de almacenamiento conserva la API usada por rutas de productos,
restaurantes, clientes y repartidores, con proveedores separados:

- **memory:** único proveedor seleccionable. Procesa imágenes base64 localmente,
  devuelve una data URL WebP y no usa disco ni red. Su eliminación es idempotente
  y no lanza errores: no existen objetos externos que eliminar. Quitar la referencia
  en la base es suficiente en esta simulación.
- **R2:** se conserva la implementación anterior detrás de un proveedor explícito,
  pero su guard sigue rechazando cualquier operación. Ninguna variable permite
  seleccionarlo en 2A.

Esto elimina el error inducido por R2 después de persistir cambios en productos,
restaurantes o perfiles, y permite eliminar productos con referencias de imagen
sin intentar borrar recursos heredados. Importar una imagen HTTP no disponible
se rechaza antes de devolver un asset al llamador; no se descarga remotamente.

El proveedor simulado NO representa almacenamiento productivo: las data URLs
pueden aumentar tamaño de filas/respuestas. No usar comprobantes ni datos reales.
Antes de habilitar almacenamiento persistente, implementar outbox/borrado
best-effort y comprobar la consistencia entre base y objetos. No volver a lanzar
errores de limpieza como si una escritura ya confirmada no hubiera ocurrido.

### 9.4 Jobs preservados, individualizados y todos apagados

`jobs/policy.ts` inventaría cada job y su grupo: ciclo de pedidos, mantenimiento,
facturación, notificaciones y almacenamiento externo. Se conserva la lógica de
inicio y la dependencia del corte de repartidores antes del procesamiento de mora.
Todas las selecciones son falsas; cualquier solicitud `true` o nombre desconocido
falla ANTES de registrar cron o crear sockets. La antigua bandera global tampoco
habilita trabajos. La reapertura futura requiere revisar cada capacidad.

### 9.5 Runtime preparado: fuentes permitidas, imágenes nuevas y egreso cerrado

Punto de entrada de infraestructura: `infrastructure/runtime/compose.yml` y su
Dockerfile. Los Dockerfiles antiguos conservan la cuarentena y ahora incluyen
las dependencias de configuración necesarias; NO son el procedimiento de arranque.

El contexto Docker cambió de blocklist a allowlist. Excluye compilados host,
scripts administrativos/ignorados, datos persistidos de `src/data`, tests no permitidos, Git,
Vercel, entornos, Firebase, firmas, respaldos y APK. Solo se copian fuentes y
configuraciones de build explícitas. El build exige una imagen aprobada sin `/app`
preexistente, dependencias/engines cacheados, `npm ci --offline --ignore-scripts`
y RUNs sin red. Nunca copia el `dist` del host: los outputs se crean de nuevo.
Solo los unitarios nuevos enumerados pueden entrar al target `unit-tests`, cuyo
CMD también está bloqueado por defecto. El target final `runtime` copia outputs
seleccionados, no el árbol backend de fuentes/tests; los setups Jest no se emiten.

El launcher de runtime exige contenedor, perfil `container`, marcador de build
nuevo y autorización explícita. Los comandos host `dev` siguen cerrados. El
marcador no sustituye verificar el digest y procedencia de la imagen en 2B.

Infraestructura preparada, NO creada:

| Recurso | Identidad/configuración prevista |
| --- | --- |
| Proyecto Compose | `wingslab-2b`, perfil explícito `approved-2b` |
| Red | `wingslab_2b_internal`, subnet `172.30.240.0/24`, IPv6 apagado |
| PostgreSQL | `172.30.240.10:5432`, base y usuario app `wingslab_local` |
| Redis | `172.30.240.11:6379`, DB 0, contraseña nueva |
| Aplicaciones | namespace compartido `172.30.240.20`, loopback entre procesos |
| Volúmenes | `wingslab_2b_postgres_v1`, `wingslab_2b_redis_v1` |
| Ingreso desde host | solo `127.0.0.1:3101–3104` |

Backend, comensal, restaurante y repartidor tienen servicios preparados. El
administrador se conserva y compila, pero no se expone en Compose en esta fase.
Las aplicaciones no tienen capacidades de red privilegiadas, usan UID 1000 y
filesystem de solo lectura salvo tmpfs explícitos de `/tmp` y caches Next. No hay
montaje del repositorio completo, Docker socket, HOME, backups ni credenciales del host.

Tres namespaces separados tienen contenedores guard con NET_ADMIN: aplicaciones,
PostgreSQL y Redis. Los servicios de negocio NO reciben esa capacidad. El script
de red exige contenedor, establece DROP por defecto para nuevas salidas, permite
solo DB/Redis desde aplicaciones y respuestas a conexiones admitidas, bloquea DNS
antes de permitir loopback y cierra IPv6. PostgreSQL/Redis no tienen nuevas salidas
remotas permitidas. `internal: true` complementa esta política, no la reemplaza.

**No se ha probado aún que estas reglas funcionen en Docker Desktop/macOS.** Si
iptables/ip6tables o una condición fallan, no se marca el guard saludable ni se
deben iniciar dependientes. No retirar reglas para sortear errores de plataforma.
El navegador del host queda fuera de los namespaces: usar perfil limpio y, para
pruebas de cero egreso total, navegador también aislado o firewall verificado.

### 9.6 Identidad antes del acceso a datos de aplicación

La inicialización PostgreSQL prepara un esquema `wingslab_identity` con UUID de
instancia y acceso de solo lectura para la app. El backend comprueba UUID, base y
usuario mediante consulta de solo lectura antes de exponer su cliente.

Redis inicializa el marcador solo si NO existe información previa en ninguna DB;
si hay marcador, exige coincidencia y nunca lo sobrescribe. El backend verifica
su valor antes de habilitar Redis. Las contraseñas Redis no se pasan en argumentos
del servidor ni se serializan errores AUTH; su config temporal no va al volumen.

Los marcadores son evidencia de identidad del entorno controlado, NO una prueba
criptográfica de infraestructura. Se combinan con autenticación nueva, inspección
de volúmenes/labels, subnet exclusiva y firewall. Un volumen preexistente, UUID
discordante o credenciales equivocadas deben detener el procedimiento, nunca
provocar reset, restauración o reetiquetado automático de datos.

### 9.7 Builds y pruebas herméticas preparados

- Se retiraron `next/font/google` y el import CSS Google Fonts. Se conserva el
  contrato de variables tipográficas con fuentes de sistema; no se rediseñó UI.
- Se retiraron preconnects remotos y los tags Google Maps quedan conservados pero
  deshabilitados explícitamente, además de la CSP y el entorno sin credenciales.
- Se corrigieron el contrato de respuesta de imágenes (`memory`) y los módulos
  necesarios de Docker, y se eliminaron validadores de URL duplicados.
- `jest.hermetic.config.cjs` selecciona SOLO `*.unit.test.ts`. Los tests antiguos
  e integraciones no se reabrieron indiscriminadamente.
- Se prepararon tests para parseo puro, Prisma sin clientes reales, proveedores
  externos bloqueados, limpieza post-persistencia y activación de jobs rechazada.
- El setup hermético bloquea sockets, listen, lookup y fetch como defensa adicional.
  Descarta variables heredadas antes de cargar los módulos de aplicación.
  No es un sandbox universal: ejecutar tests requiere igualmente frontera de red.
- **No se ejecutó ninguna prueba ni build.** La revisión semántica usa el compilador
  como analizador, sin emit ni plugins y sin evaluar módulos del proyecto.

### 9.8 Archivos afectados en Fase 2A

Además de retirar las cuatro entradas simbólicas autorizadas, se modificaron o
añadieron los siguientes archivos (el inventario de Fase 1 se conserva arriba):

```text
.dockerignore
.env.wingslab.example
.gitignore
config/wingslab.cjs
config/wingslab.local.example.json
config/wingslab.frontend.example.json
scripts/wingslab-run.cjs
scripts/wingslab-build.cjs
package.json
packages/shared/tsconfig.json
packages/shared/src/index.ts
packages/shared/src/web.ts
packages/shared/src/wingslab-config.ts
packages/shared/src/wingslab-policy.js
packages/backend/package.json
packages/backend/tsconfig.json
packages/backend/jest.hermetic.config.cjs
packages/backend/src/app.ts
packages/backend/src/index.ts
packages/backend/src/config/database.ts
packages/backend/src/config/env.ts
packages/backend/src/config/redis.ts
packages/backend/src/config/isolation.ts
packages/backend/src/config/isolation.unit.test.ts
packages/backend/src/hermetic-setup.ts
packages/backend/src/jobs/policy.ts
packages/backend/src/jobs/policy.unit.test.ts
packages/backend/src/services/storage.service.ts
packages/backend/src/services/storage/memory.provider.ts
packages/backend/src/services/storage/storage.unit.test.ts
packages/backend/src/services/otp-delivery.service.ts
packages/backend/src/routes/auth.routes.ts
packages/web-customer/next.config.js
packages/web-customer/package.json
packages/web-customer/src/app/layout.tsx
packages/web-customer/src/styles/globals.css
packages/web-restaurant/next.config.js
packages/web-restaurant/package.json
packages/web-restaurant/src/styles/globals.css
packages/web-restaurant/src/app/layout.tsx
packages/web-driver/next.config.js
packages/web-driver/package.json
infrastructure/docker/Dockerfile.backend
infrastructure/docker/Dockerfile.web
infrastructure/runtime/Dockerfile
infrastructure/runtime/compose.yml
infrastructure/runtime/network.sh
infrastructure/runtime/postgres-identity.sh
infrastructure/runtime/redis-identity.sh
docs/AISLAMIENTO_WINGSLAB.md
```

### 9.9 Procedimiento exacto para Fase 2B (requiere nueva autorización)

1. Revisar este diff y aprobar la creación de recursos NUEVOS. Comprobar que subnet,
   nombres y volúmenes previstos no existen ni colisionan. Si existen, detenerse;
   no reutilizar ni eliminar nada automáticamente.
2. Aprobar imágenes por digest: Node/build con dependencias y engines cacheados,
   firewall con iptables/ip6tables, PostgreSQL 16 y Redis 7. Auditar que no contienen
   configuración productiva. Aprovisionarlas con autorización separada, antes de
   cerrar la red; Compose usa `pull_policy: never` y no debe descargar imágenes.
3. Generar UUID v4 y secretos locales independientes, sin imprimirlos. Crear los
   archivos de `infrastructure/runtime/secrets/` y las dos configuraciones locales
   regulares, permisos restrictivos; no crearlos desde ningún backup SaDeL.
   Backend container: URL PG a `.10:5432/wingslab_local` con usuario `wingslab_local`;
   URL Redis a `.11:6379/0` con usuario `default`. Contraseñas de al menos 32 caracteres.
   La configuración pública de frontends nunca debe contener claves del backend.
4. Examinar el contexto efectivo de build antes de usarlo: debe carecer de todo
   material heredado excluido. Construir imagen NUEVA sin red y sin ejecutar tests
   de servicios. Cualquier dependencia faltante exige volver al aprovisionamiento
   aprobado, no habilitar red en los RUNs ni reutilizar dist viejo.
5. Ejecutar primero solo los guards de red, tras aprobación. Verificar reglas,
   IPv6, DNS y bloqueo del gateway host usando destinos simulados propios, NUNCA
   sondas a SaDeL. No habilitar aplicaciones por el simple booleano de configuración.
6. Autorizar el bootstrap de PostgreSQL/Redis sobre volúmenes nuevos. Los scripts
   preparan únicamente roles y marcadores, NO migraciones ni datos de negocio.
   Verificar UUID, credenciales, permisos, labels y propietarios; no publicar los
   puertos de datos en el host ni abrir acceso desde redes ajenas.
7. Resolver la cadena Prisma para una base desechable exclusivamente WingsLab:
   generar/revisar un baseline nuevo manteniendo las migraciones SaDeL como
   historia. Verificar esquema, índices, relaciones y reproducibilidad. No invocar
   migraciones heredadas ni `db push` indiscriminado sobre un destino desconocido.
8. Ejecutar las pruebas herméticas dentro del entorno sin egreso. Luego preparar
   fixtures con un restaurante, usuarios por rol, catálogo, repartidor, ubicaciones
   simuladas y pedidos, sin contactos reales, tokens push ni dumps. La autorización
   de migración/fixtures será específica y posterior a comprobar identidad.
   Para unitarios, construir el target separado `unit-tests` y ejecutar únicamente
   Jest con `jest.hermetic.config.cjs`, red `none`, usuario 1000, raíz de solo lectura
   y `/tmp` efímero. No usar ese target como imagen de aplicaciones ni ejecutar sus
   tests por defecto fuera del sandbox; el target final de Compose es `runtime`.
9. Solo con evidencias de red/identidad/esquema, aprobar `authorization.runtime`
   y `networkVerified` en las configuraciones locales. Esos flags registran una
   decisión humana; no reemplazan las verificaciones. Iniciar backend individual,
   comprobar salud y ausencia de egreso, y después un frontend a la vez.
10. Probar autenticación simulada, productos con imágenes inline, edición y borrado,
    pedidos manuales, Socket.IO y geolocalización ficticia. Jobs y proveedores cloud
    permanecen cerrados. Revisar límites de tamaño/errores y escrituras confirmadas.

Firebase, R2, mensajería, despliegues y Android NO son requisitos para desarrollar
los flujos web locales. Siguen pendientes de proyectos/identidades propios y otra
autorización. Git e historial requieren escaneo de secretos antes de publicación.
No iniciar transformación funcional hasta demostrar aislamiento en 2B.

### 9.10 Verificaciones realizadas en 2A

- 52 archivos regulares de esta fase comprobados dentro de WingsLab; las únicas
  eliminaciones fueron las cuatro entradas simbólicas autorizadas.
- 42 archivos JS/CJS/TS/TSX/JSON/YAML/CSS analizados sintácticamente, sin evaluar
  módulos del proyecto: cero errores. Los tres scripts sh pasaron `sh -n` por separado.
- Análisis semántico estático de backend/shared, nuevos unitarios y cuatro frontends:
  cero diagnósticos. Sin emit, cachés incrementales ni plugins Next; shared se
  resuelve al fuente, no al dist heredado. Esto NO equivale a un build empaquetado.
- Revisión estática de los nueve servicios preparados: perfil explícito, imágenes
  sin pull automático, sin modo host/privileged y publicaciones solo loopback.
- `git diff --check` sin errores de whitespace.
- Confirmado por metadatos que no existen configuraciones `.local.json` ni el
  directorio de secretos nuevos. No se generaron secretos ni autorizaciones reales.

No se ejecutaron Jest, builds, Docker, migraciones, seeds, aplicaciones ni comandos
cloud. No hubo accesos a servicios, commits, pushes ni cambios al proyecto SaDeL.

### 9.11 Riesgos y límites todavía pendientes

- Falta comprobar dinámicamente todo el runtime, incluido Docker Desktop/macOS,
  soporte iptables/ip6tables, DNS, ruta al host y aislamiento del navegador.
- Falta construir las imágenes offline, validar engines Prisma/sharp por plataforma,
  ejecutar los tests preparados y comprobar cachés/ISR Next bajo raíz de solo lectura.
- La identidad se comprueba al arranque: evaluar reconexiones/cambios de instancia
  antes de exigir garantías de identidad continua. No sustituir servicios o volúmenes
  con aplicaciones activas. Un marcador no reemplaza aislamiento ni procedencia.
- Los volúmenes/roles/esquemas/fixtures no existen y el baseline Prisma está pendiente.
  No restaurar dumps ni cambiar datos para hacer pasar una comprobación.
- Las APIs de almacenamiento simulado requieren pruebas de tamaño, tipos de URL,
  edición/borrado y respuestas posteriores a commit antes de considerarlas validadas.
- El material heredado sigue accesible fuera del runtime; comandos host directos no
  quedan globalmente interceptados. Mantenerse en los puntos de entrada aprobados.
- Firebase, Android, firmas y vínculos cloud siguen conservados y bloqueados; no
  habilitarlos hasta completar su separación. No se auditó íntegramente el historial
  de secretos ni se autorizó publicar el repositorio.

## 10. Fase 2B — preflight y primer punto de autorización

### 10.1 Resultado observado en esta sesión

Se revisaron el estado Git, el diff relevante de configuración/arranque y los
archivos reales de runtime. Las consultas Docker fueron exclusivamente de lectura,
con contexto fijado explícitamente a `desktop-linux`, verificado como socket Unix
local ANTES de consultar el daemon. No se consultó un Docker remoto.

- Docker Engine local: `29.8.2`, Linux/arm64, Docker Desktop en macOS.
- Plugin Compose local: `5.6.0`.
- Ningún contenedor, red, volumen o imagen WingsLab aparece en el inventario local.
- No hay solapamiento visible entre `172.30.240.0/24` y las subnets Docker existentes.
  Tampoco apareció una ruta no predeterminada del host que solape ese rango.
- Los puertos 3101–3104, 55433 y 56379 no muestran listeners TCP visibles. Es una
  observación de metadatos, no una reserva: debe repetirse justo antes de crear.
- Existen recursos ajenos que NO deben usarse: red `docker_sadel-network`, volúmenes
  `docker_postgres_data`/`docker_redis_data` y recursos de avocadoc/agropack, entre otros.
  No se inspeccionaron datos ni entornos de sus contenedores, ni se alteraron recursos.
- No se detectaron enlaces simbólicos en el árbol de fuentes/configuración examinado
  ni nombres de variables heredadas de proveedores/conexiones en el proceso actual.
  No se imprimieron valores de variables. Esto no certifica otros shells o imágenes.
- Continúan ausentes las configuraciones locales activas y el directorio de secretos.

La primera presentación de subnets encontró un error LOCAL del script de lectura
por `IPAM.Config = null` en redes especiales. Se repitió la consulta tolerando ese
caso y terminó sin solapamientos. No fue un fallo de un servicio ni se modificó Docker.

### 10.2 Imágenes y bloqueos de aprovisionamiento

Único candidato base disponible para esta arquitectura:

```text
postgres@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d
Linux/arm64
```

Se verificó su identidad por metadatos LOCALES; no se consultó el registro ni se
ha aprobado aún su utilización. Compartir una imagen oficial de solo lectura no
implica compartir un contenedor, configuración o volumen. No se reutilizarán los
contenedores PostgreSQL existentes.

No aparecen imágenes base Node/build, Redis ni una imagen aprobada de firewall.
Tampoco existe una imagen WingsLab runtime/unit-tests ni una caché Linux/arm64
aprobada de dependencias/engines. `node_modules` macOS no reemplaza esa caché.
Las imágenes de otras aplicaciones NO se adoptan como base.

**Bloqueo:** no se pueden construir ni arrancar los guards y el entorno verificado
con los recursos actualmente aprobados. No se descargó ninguna imagen/dependencia.

El eventual aprovisionamiento requiere autorización para bases oficiales Node 22,
Redis 7, una base Linux para iptables/ip6tables y herramientas de pruebas, frontend
Dockerfile/BuildKit si son necesarios, paquetes del sistema, dependencias públicas
del lockfile npm y engines Prisma. Antes de usarlas se fijarán identidad, digest,
plataforma y procedencia. Ninguna descarga ni ejecución de build está autorizada
por el simple hecho de figurar en este documento.

### 10.3 Protecciones locales corregidas antes de crear recursos

Archivos actualizados en este preflight:

1. `infrastructure/runtime/network.sh`: denegación explícita de `127.0.0.11/32`
   ANTES de permitir loopback. Docker puede traducir el puerto DNS 53 a uno alto
   antes del filtro OUTPUT; comprobar solo `--dport 53` no era suficiente.
   Se agregó también DROP para FORWARD IPv6. No se ejecutó iptables en el host.
2. `infrastructure/runtime/compose.yml`: labels de propiedad `org.wingslab.project`,
   fase e instancia para servicios, red y volúmenes. El UUID se suministrará recién
   después de autorización. Todos los bind mounts usan `create_host_path: false`
   para que un archivo ausente no se convierta silenciosamente en un directorio.
3. Este documento: resultados reales, bloqueos y recursos sujetos a aprobación.

Además de esos labels se comprobarán los automáticos de Compose:
`com.docker.compose.project=wingslab-2b`, servicio, red y volumen según corresponda.
Si un recurso ya existe, se detiene el procedimiento; los labels no autorizan
reutilización ni eliminación automática.

La restricción de DNS, IPv6, gateway/host y Docker Desktop sigue SIN VALIDACIÓN
DINÁMICA. Las pruebas usarán endpoints simulados propios y deben impedir que una
consulta DNS de prueba termine en resolutores públicos. No se sondará SaDeL.
La sintaxis YAML y shell, los labels, el orden de la denegación DNS y los mounts
sin autocreación pasaron comprobaciones estáticas; `git diff --check` también.
Estas comprobaciones no ejecutan los guards ni validan su funcionamiento real.

### 10.4 Inventario a autorizar ANTES del primer recurso o secreto

| Tipo | Recursos nuevos previstos |
| --- | --- |
| Proyecto | `wingslab-2b`, perfil `approved-2b` |
| Red | `wingslab_2b_internal`, `172.30.240.0/24`, interna, IPv6 deshabilitado |
| Volúmenes | `wingslab_2b_postgres_v1`, `wingslab_2b_redis_v1` |
| Guards | `wingslab-2b-runtime-net-1`, `wingslab-2b-postgres-net-1`, `wingslab-2b-redis-net-1` |
| Datos | `wingslab-2b-postgres-1`, `wingslab-2b-redis-1`, sin puertos publicados al host |
| Identidad | UUID v4 nuevo; marcadores PostgreSQL/Redis; roles `wingslab_owner` y `wingslab_local` |
| Secretos | Tres archivos locales de PG owner/app y Redis; JWT/cifrado nuevos en configuración privada |
| Configuración | `config/wingslab.local.json`, `config/wingslab.frontend.local.json`, permisos restrictivos |
| Build/pruebas | Imágenes propias runtime/unit-tests/firewall/build y recursos temporales de build/probes con prefijo WingsLab |
| Aplicaciones, posterior | `wingslab-2b-backend-1`, `wingslab-2b-restaurant-1`, `wingslab-2b-customer-1`, `wingslab-2b-driver-1` |
| Puertos de aplicaciones | Únicamente `127.0.0.1:3101–3104`; habilitar no implica autorización para arrancarlas |

La autorización inicial solicitada comprende aprovisionamiento público aprobado,
infraestructura NUEVA y pruebas controladas sin producción. Los nombres y labels
de cada recurso temporal se verificarán antes de crearlo. No se usará el builder
de una aplicación ajena ni se modificará su caché/contenerización deliberadamente.
Los builders efímeros que requieran crear contenedores también están sujetos a esta
autorización. Nada de esto se ha creado en esta sesión.

El arranque de las cuatro aplicaciones requiere OTRA aprobación explícita, tras
red, identidad, schema, pruebas y fixtures. No se habilitarán flags runtime antes.

### 10.5 Estado de ejecución y continuación

- Infraestructura creada: **ninguna**.
- Identidades PG/Redis en ejecución verificadas: **ninguna**; solo metadatos de imagen candidata.
- Pruebas Jest/integración, builds y smoke tests: **no ejecutados**.
- Migraciones, fixtures y modificaciones a bases: **ningunas**.
- Aplicaciones WingsLab iniciadas: **ninguna**.
- Aislamiento real y desarrollo funcional: **todavía no autorizados**.

Tras aprobar recursos/descargas, se repite el inventario para descartar cambios o
colisiones, se fija la procedencia de imágenes y se sigue 9.9, adelantando unitarios
sin infraestructura cuando el sandbox esté disponible. No se saltarán fallos ni
se retirarán guards para lograr un arranque.

Los comandos de inicio/parada definitivos se documentarán con imágenes e identidad
reales una vez validados. Usarán contexto `desktop-linux`, proyecto `wingslab-2b`
y archivo Compose explícitos, comprobando propiedad antes de cualquier operación.
No hay autorización actual para ejecutarlos ni para detener recursos ajenos.

## 11. Fase 2B — inventario de recursos locales y metadatos verificados

### 11.1 Metodología y límites

Inspección exclusivamente de lectura. Se consultó el daemon Docker local por socket
Unix (contexto `desktop-linux` verificado antes de cualquier consulta) y endpoints
públicos de metadatos: manifiestos OCI, configuraciones de imagen e índice de
paquetes Alpine. NO se descargaron capas ni paquetes, NO se crearon contenedores,
redes, volúmenes ni secretos, NO se arrancaron servicios y NO se tocaron recursos
ajenos. La caché npm y BuildKit solo se leyó por metadatos y hash.

Nota de entorno: Python no confía en la CA del entorno (TLS interceptado), por lo
que las consultas directas fallaron; `curl` y las utilidades de Docker sí validan
correctamente. No se desactivó ninguna verificación TLS en ningún momento.

### 11.2 Recursos disponibles sin descarga

| Recurso | Versión / identidad | Arquitectura | Nota |
| --- | --- | --- | --- |
| Docker Engine | 29.8.2 | linux/arm64 | Docker Desktop, contexto `desktop-linux` |
| Docker Compose | 5.6.0 | — | plugin local |
| Buildx | 0.37.2 | — | driver por defecto; sin volumen `buildx_buildkit_` propio |
| Node nativo | 26.5.1 | darwin/arm64 | cumple `engines` (next >=20.9, sharp >=20.9, firebase-admin >=22) |
| npm | 11.17.0 | darwin/arm64 | no se ejecutó npm en modo resolutor |
| PostgreSQL oficial | 16.15, digest `sha256:ca0bd484...641d` | linux/arm64 | imagen completa local; reutilizable |
| Alpine + Nginx | `nginx:alpine`, Alpine 3.24.3, digest `sha256:785835ea...606` | linux/arm64 | base Alpine disponible |
| Caché npm | 921/999 tarballs verificados por hash, 0 discrepancias | — | sin escrituras ni limpieza |
| Caché BuildKit | 294 registros (~5 GiB lógicos, contenido compartido) | — | incluye capas de `node:24-alpine` |

Las capas de `node:24-alpine` existen en caché pero NO están registradas como imagen
ejecutable: recuperarlas exigiría un pull autorizado. No se reutilizan capas sueltas
de origen no verificado.

Redis 8.6.2 nativo en Homebrew y clientes PostgreSQL (libpq 18.4) existen en el
Mac, pero son binarios Darwin: no sirven como servidores Linux aislados.

### 11.3 Metadatos públicos verificados de lo que falta

Consultados por manifiesto OCI y configuración de imagen, con verificación de digest:

| Imagen | Plataforma | Digest de manifiesto (arm64) | Digest de índice | Tamaño comprimido | Versión pública |
| --- | --- | --- | --- | ---: | --- |
| `redis:7-alpine` | linux/arm64/v8 | `sha256:52d1ea8a654b10f06af3ecda4e9dbcd035c7868b5c49ee7975de917f81de13db` | `sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe` | **16,13 MiB** (7 capas) | `REDIS_VERSION=7.4.12` |
| `alpine:3.24.3` | linux/arm64/v8 | `sha256:e311ae748be7f56ae5cba304bc488f0786df68ee507513f654a5cc8597cffb42` | `sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a` | **4,0 MiB** (1 capa) | Alpine 3.24.3 |

Paquetes de aislamiento disponibles en Alpine 3.24 `main/aarch64` (índice leído, sin
descargar `.apk`): `iptables 1.8.13-r0` (incluye `ip6tables`), `libmnl 1.0.5-r2`,
`libnftnl 1.3.1-r0`, `libxtables 1.8.13-r0`. Instalación conjunta ≈ 0,58 MiB; con la
base Alpine completa ≈ 7,2 MiB instalados.

### 11.4 Simplificación de la infraestructura de aislamiento

La Fase 2A preparaba tres guards con `iptables` dentro de contenedores privilegiados.
Eso es complejo y añade una imagen con NET_ADMIN. Se propone un control PRIMARIO
mucho más simple y verificable:

1. **Red Docker `internal: true`** como control de egreso: los contenedores quedan
   en la subred `172.30.240.0/24` sin ruta de salida a Internet.
2. **Verificación empírica obligatoria** con destinos simulados propios: resolución
   DNS externa, conexión a una IP de Internet, acceso al gateway del host y acceso
   directo a servicios del host. Si `internal: true` resultara insuficiente en
   Docker Desktop, se aplicaría como SEGUNDO control los guards con `iptables`
   (paquetes Alpine ya identificados, ~0,6 MiB) y solo entonces.
3. Se mantienen: puertos publicados solo en `127.0.0.1`, UID 1000, `read_only`,
   `cap_drop: ALL`, `no-new-privileges`, ausencia de socket Docker, volúmenes y
   credenciales exclusivos, marcadores de identidad y verificación previa del UUID.

Regla de decisión: no se retirará ninguna protección existente; el control con
`iptables` solo se añade si la verificación demuestra que la red interna no basta.
Nunca se probará contra SaDeL: las pruebas negativas usarán destinos simulados.

### 11.5 Decisiones registradas sobre Prisma y datos

- Las migraciones históricas de SaDeL se conservan íntegras como trazabilidad.
- Se generará un baseline NUEVO exclusivo de WingsLab para bases vacías, sin ejecutar
  la cadena heredada (que usa `ALTER TYPE ... ADD VALUE` y no es reproducible sobre
  una base recién creada) ni `db push` indiscriminado.
- El esquema se validará contra la base desechable identificada por marcador UUID.
- Los fixtures serán sintéticos: un restaurante WingsLab, usuarios por rol, catálogo,
  repartidor y pedidos. Sin teléfonos, correos ni tokens reales.

### 11.6 Estado

Recursos creados: **ninguno**. Descargas: **ninguna**. Aplicaciones: **ninguna**.
Identidades verificadas en ejecución: **ninguna**. Pendiente: autorización del lote
mínimo de la sección siguiente.

## 12. Fase 2B — infraestructura creada y aislamiento verificado

### 12.1 Recursos creados (exclusivos de WingsLab)

| Recurso | Nombre | Estado |
| --- | --- | --- |
| Proyecto Compose | `wingslab-2b` | activo |
| Red aislada | `wingslab_2b_internal` (172.30.240.0/24, `internal: true`, IPv6 off) | activo |
| Red de borde | `wingslab_2b_edge` (172.31.240.0/24) | activo, solo para el reenviador |
| Volumen PostgreSQL | `wingslab_2b_postgres_v1` | activo, recreado vacío una vez |
| Volumen Redis | `wingslab_2b_redis_v1` | activo |
| PostgreSQL | `wingslab-2b-postgres-1` (16.15, 172.30.240.10) | healthy |
| Redis | `wingslab-2b-redis-1` (7.4.12, 172.30.240.11) | healthy |
| Reenviador de borde | `wingslab-2b-edge-1` | activo, sin código ni credenciales |
| Base desechable | `wingslab_migration_test` | creada, migrada, con datos ficticios |

Labels de propiedad aplicados a red, volúmenes y contenedores:
`org.wingslab.project=wingslab`, `org.wingslab.phase=2b`, `org.wingslab.instance=<uuid>`,
más los labels automáticos de Compose. Nada ajeno fue creado, modificado ni eliminado:
los recursos existentes de SaDeL y otros proyectos se listaron y se dejaron intactos.

### 12.2 Cambio de topología y su motivo

La plantilla de Fase 2A suponía que Docker publicaba puertos en redes `internal`.
**En Docker Desktop/macOS no lo hace**: el host rechaza la conexión y el reenviador
hacia PostgreSQL/Redis era imposible. La corrección fue:

1. La red `internal` conserva a PostgreSQL, Redis y a las aplicaciones (sin ruta
   de salida, sin acceso al gateway del host).
2. Un único contenedor `edge` en una red enrutable reenvía TCP a destinos FIJOS
   de la red aislada y publica solo en `127.0.0.1`. No contiene código de
   aplicación ni credenciales: es un relé de una sola dirección por puerto.
3. BusyBox `nc -e` no acepta argumentos, por lo que cada destino tiene su propio
   envoltorio en `infrastructure/runtime/edge/`. Es un límite de la herramienta,
   no una dejada de la barrera.

### 12.3 Identidades verificadas

| Comprobación | Resultado |
| --- | --- |
| UUID en configuración == `runtime.env` | coinciden |
| Marcador PostgreSQL == UUID de configuración | coincide |
| Marcador Redis == UUID de configuración | coincide |
| Rol de aplicación en PostgreSQL | `wingslab_local`, sin superusuario ni CREATEDB |
| Base y usuario de la conexión | `wingslab_local` / `wingslab_local` |
| Tablas en `public` antes de migrar | 0 |
| `DBSIZE` de Redis | 1 (solo el marcador de identidad) |
| Esquemas no sistémicos | solo `public` (y `wingslab_identity`) |
| Roles presentes | `wingslab_owner`, `wingslab_local` |
| Volumen PostgreSQL recreado | una vez, tras detectar que un arranque fallido previo lo había inicializado |

Detalle de un fallo real encontrado y corregido: el primer arranque de PostgreSQL
falló por `cap_drop: ALL` (el entrypoint oficial necesita `CHOWN`, `SETUID`, `SETGID`,
`FOWNER`, `DAC_OVERRIDE`) y dejó el volumen inicializado sin el script de identidad.
Se corrigieron las capacidades mínimas, se comprobó que el volumen solo contenía
el cluster vacío (0 tablas, 0 migraciones, rol inexistente) y se recreó EXCLUSIVAMENTE
ese volumen de WingsLab. Se verificó antes que sus labels eran propios.

### 12.4 Aislamiento verificado empíricamente

Sondas ejecutadas DENTRO de la red aislada, con un par simulado propio en otra red
(nunca contra dominios de SaDeL):

| Prueba | Resultado |
| --- | --- |
| Rutas por defecto (`ip route`) | 0 |
| Direcciones IPv6 globales | 0 (solo `::1`) |
| Resolución DNS de nombre externo | falla (SERVFAIL) |
| TCP hacia el par simulado externo | BLOQUEADO |
| TCP hacia el gateway del host | BLOQUEADO |
| TCP hacia PostgreSQL propio | ALCANZABLE |
| TCP hacia Redis propio | ALCANZABLE |
| Puertos publicados en la red interna | sin efecto (por eso existe `edge`) |
| Puertos de la red interna desde el host | no alcanzables directamente |
| Puertos publicados por `edge` | solo `127.0.0.1` |

Los servicios de datos no son alcanzables desde el host por IP de puente: el acceso
del host es exclusivamente por `edge` y con contraseña propia.

### 12.5 Prisma: baseline reproducible

La cadena histórica de 44 migraciones **no es reproducible sobre una base vacía**:
`BusinessType` se alteraba (`ADD VALUE`) antes de existir, `FulfillmentType` y
`FeaturedPurchaseStatus` nunca se creaban y la migración de simplificación
convertía la columna a `text`. Decisión:

- Las 44 migraciones de SaDeL se conservan **intactas** en
  `packages/backend/prisma/migrations-sadel-history/` (movidas con `git mv`, sin
  reescrituras) para referencia y trazabilidad.
- `packages/backend/prisma/migrations/` contiene un único baseline
  `20261113000000_wingslab_baseline`, generado con
  `prisma migrate diff --from-empty --to-schema-datamodel` desde el schema actual.
- `prisma migrate deploy` aplicó el baseline sobre la base desechable y el
  `prisma migrate diff --from-url … --to-schema-datamodel` devolvió
  "No difference detected" (cero deriva).
- Se destruyó y recreó la base desechable y se volvió a migrar: **reproducible**.
- Verificación estructural: 42 tablas, 18 enums, 156 índices, 43 claves foráneas.
- No se usó `db push`. No se modificó ninguna base ajena.

### 12.6 Pruebas ejecutadas

| Suite | Resultado |
| --- | --- |
| Unitarias herméticas (`jest.hermetic.config.cjs`) | 3 suites, 11 pruebas, todas pasan |
| Análisis estático TypeScript (backend/shared/frontends) | 0 diagnósticos |
| `git diff --check` | sin errores |
| Deriva Prisma DB ↔ schema | sin diferencias |

El setup hermético descarta variables heredadas y bloquea sockets, `listen`,
`dns.lookup` y `fetch`. Las suites antiguas de integración siguen sin ejecutarse:
requieren el cliente real y un entorno específico, y se habilitarán por separado.

### 12.7 Datos ficticios

`packages/backend/src/scripts/wingslab-seed.ts` crea datos 100 % sintéticos, con
identificadores fijos (idempotente) y guardas: base en la lista desechable de
WingsLab y marcador de identidad verificado en la base primaria antes de escribir.

Creado: 1 región, 4 usuarios (admin, restaurante, cliente, repartidor), 1 restaurante,
1 categoría, 3 productos, 1 cliente, 1 repartidor, 1 dirección, 3 pedidos
(`PENDING`, `PREPARING`, `DELIVERED`) y 3 ítems.

Verificado: teléfonos solo ficticios (`550000…`), 0 tokens FCM, 0 suscripciones push,
0 comprobantes de pago, `whatsappNotifications` en falso, repartidor asignado solo
al pedido entregado, totales calculados y dirección vinculada.

Acceso ficticio (no son credenciales de ningún sistema real):
`admin@wingslab.local`, `restaurante@wingslab.local`, `cliente@wingslab.local`,
`repartidor@wingslab.local`, con contraseña local compartida para los cuatro.

### 12.7.1 Comandos verificados de arranque y parada

Verificados en esta sesión contra el proyecto `wingslab-2b`:

| Acción | Comando | Resultado |
| --- | --- | --- |
| Crear/actualizar | `$D up -d` | 3 contenedores creados/actualizados, 2 volúmenes, 2 redes |
| Estado | `$D ps` | PostgreSQL y Redis healthy |
| Parar | `$D stop` | detiene solo contenedores de `wingslab-2b` |
| Reanudar | `$D start` | reanuda solo esos contenedores |
| Eliminar | `$D down` | elimina contenedores y red; conserva volúmenes |
| Registro | `$D logs -f postgres` | registro del servicio |

`$D down` sin `-v` conserva `wingslab_2b_postgres_v1` y `wingslab_2b_redis_v1`.
Nunca se ejecutó `docker system prune` ni borrado global de volúmenes.

### 12.8 Comandos documentados (solo WingsLab)

```bash
cd infrastructure/runtime
export COMPOSE_PROFILES=approved-2b
D="docker --context desktop-linux compose --project-name wingslab-2b --file compose.yml --env-file runtime.env"

$D up -d                 # PostgreSQL + Redis + reenviador
$D ps                   # estado
$D stop                 # detiene SOLO los contenedores de wingslab-2b
$D down                 # elimina contenedores y red de wingslab-2b (conserva volúmenes)
$D logs -f postgres     # registro del servicio
```

Reglas de seguridad de estos comandos: siempre con `--project-name wingslab-2b` y
`--file compose.yml`; nunca `docker system prune` ni borrado global de volúmenes;
`down` sin `-v` conserva los datos exclusivos de WingsLab. Los recursos de SaDeL y
otros proyectos no se enumeran ni se modifican con estos comandos.

### 12.9 Estado de las aplicaciones

Las aplicaciones siguen **sin iniciarse** (perfil `approved-apps`, imagen runtime
pendiente y autorización aparte). Los flags `runtime` y `networkVerified` de las
configuraciones locales siguen en `false`: su activación requiere una segunda
autorización explícita. Los guards fallan de forma segura: `frontendConfig` y
`assertLocalAuthorization` rechazan la ejecución sin autorización, verificado.

Pendiente para esa autorización: construir la imagen runtime (requiere imagen Node
linux/arm64 y las 7 dependencias nativas ausentes de caché: SWC, sharp/libvips,
esbuild, unrs-resolver y wasm), y con ella arrancar backend, panel de restaurante,
app de cliente y app de repartidor en orden, comprobando salud, catálogo,
autenticación simulada, ciclo de pedido y almacenamiento simulado.

## 13. Fase 2C — corrección del borde y runtime backend preparado

El resultado actualizado y sus comandos están en [`FASE_2C_RUNTIME.md`](FASE_2C_RUNTIME.md).
Las afirmaciones previas de acceso exclusivo desde el host eran incompletas:
los relés escuchaban en ambas redes Docker. Se corrigieron sus escuchas a la
interfaz de ingreso, se desactivó forwarding IPv4/IPv6 en su namespace, se cerraron
3101–3104 y se deshabilitó ICC únicamente en la red de borde propia.

Pruebas con la imagen backend final en su IP prevista: datos propios alcanzables;
host, peer simulado externo IPv4/IPv6, relés internos y cruces entre redes
bloqueados; DNS interno funciona y nombre externo de fixture rechazado.
No se cambiaron recursos SaDeL, firewall macOS ni configuración global Docker.

Se reutilizaron las capas oficiales Node desde BuildKit y 651 tarballs verificados;
se descargaron solo 2 tarballs Sharp y 2 motores Prisma: **22,08 MiB**. Ningún APK.
Imagen backend Linux/arm64 construida offline, con dependencias de producción;
compilación, generación Prisma, carga nativa Sharp/Prisma y 11 unitarias pasan.

Backend **no iniciado**, sin contenedor de servicio creado, flags false,
integraciones/jobs bloqueados y puertos de aplicaciones cerrados. La base primaria
verificada aún carece de tablas de negocio; baseline/fixtures están en la base
desechable. Preparar esos datos y autorizar el arranque son pasos pendientes,
distintos de tener la imagen compilada y probada.

## 14. Fase 2D — base principal migrada y fixtures cargados

Con autorización específica y revalidación de UUID/servidor/usuario/public vacío
y hashes antes de escribir, se aplicó el baseline validado exclusivamente en
`wingslab_local` y se ejecutó una vez el seed sintético preparado.

Resultado real: 41 tablas de negocio + metadata Prisma, 18 enums, 156 índices,
43 claves foráneas, cero deriva; 20 registros sintéticos distribuidos en 11 tablas
y las otras 30 tablas vacías. Identidades preservadas, Redis PONG y DBSIZE=1.
Las consultas readonly desde la imagen final y las pruebas de aislamiento pasan.

No se modificaron otras bases ni recursos ajenos, ni se ejecutaron resets,
descargas o builds. Backend y frontends siguen sin iniciarse y flags false;
proveedores externos y jobs bloqueados. El próximo paso requiere una segunda
autorización para habilitar solo el ingreso backend 3101 y arrancarlo.

Detalle de operaciones, verificaciones y condiciones:
[`FASE_2D_BASE.md`](FASE_2D_BASE.md). El estado de base vacía descrito en fases
anteriores es histórico y queda sustituido por este resultado.

## 15. Primer arranque backend autorizado

Backend funcionando con imagen existente, sin migraciones/seeds/builds/descargas.
Ingreso exclusivo nuevo 127.0.0.1:3101; frontends cerrados. Identidades e
aislamiento revalidados antes y después del arranque, incluido namespace real.
Health 200 con PG/Redis/Socket.IO healthy; catálogo ficticio, detalle y zonas 200;
metrics sin sesión 401. Sin errores críticos ni secretos observados en logs y
respuestas revisados. Sin conexiones TCP inesperadas en la captura realizada.
Proveedores externos/jobs bloqueados. Configuración frontend no autorizada.

Resultado y comandos de inicio/parada: [`FASE_2D_ARRANQUE.md`](FASE_2D_ARRANQUE.md).
Las afirmaciones previas de backend no iniciado representan el estado histórico.

## 16. Fase 3 — cliente web autorizado y arrancado

Cliente funcionando en 127.0.0.1:3103 con imagen independiente, configuración sin
credenciales y rol exclusivo. Solo SWC 16.3.4 arm64-musl descargado (29,92 MiB);
resto desde caché/base Node local; build sin red. Backend/PG/Redis no reiniciados.
SSR/proxy, catálogo ficticio, navegación, carrito local y error/reintento comprobados
en Chrome local aislado. Sin requests externos observados. Aislamiento revalidado
en el namespace cliente. Restaurante, driver, Android y proveedores siguen apagados.

Portada necesita ubicación: pruebas con coordenadas ficticias de sesión; acceso
directo al restaurante funciona sin Maps. Modal de producto independiente no
disponible en el tema actual. No se probó checkout ni Socket.IO autenticado.
Detalle y límites: [`FASE_3_INTERFACES.md`](FASE_3_INTERFACES.md).

## 17. Fase 3B — restaurante funcionando

Panel en 127.0.0.1:3102, build offline con 182 paquetes locales verificados y cero
descargas. Login sintético, rol, pedidos activos/entregado, catálogo y Socket.IO
autenticado con sala/heartbeat comprobados en Chrome. Estados de los tres pedidos
preservados; guardas añadidas para impedir auto-rechazo y acciones de pedidos en
esta fase de lecturas. Backend, cliente, PG y Redis no reiniciados.

Red/host/LAN/IPv4/IPv6/DNS revalidados; no proveedores externos o jobs habilitados.
Carga y errores muestran valores por defecto ambiguos: pendiente UX, sin rediseño.
El ciclo de pedido completo aún requiere autorización de operaciones de negocio.
Detalle: [`FASE_3B_RESTAURANTE.md`](FASE_3B_RESTAURANTE.md).

## 18. Fase 3C — acciones manuales y sincronización (preparadas, sin desplegar)

La guarda única `WINGSLAB_READ_ONLY` se dividió en capacidades independientes:
acciones manuales sobre una lista explícita de pedidos ficticios, decisiones
automáticas y pedidos simulados, estas dos últimas cerradas por defecto. El
backend valida la misma lista y exige runtime verificado; los tres fixtures
originales y cualquier otro pedido rechazan toda mutación con 403. JWT, rol
RESTAURANT, restaurante ACTIVE, propiedad y transiciones se conservan; la
actualización es condicional a estado y `updatedAt`, así que el doble clic
produce 409 y no una segunda transición.

Sincronización: la ruta emite a la sala del propio restaurante (nunca a otra),
el panel escucha esos eventos y relee la lista; la fusión conserva los campos
completos que la respuesta parcial no trae y descarta respuestas antiguas por
`updatedAt`; los fallos de sincronización son visibles y las mutaciones no se
reintentan a ciegas.

No hubo build, despliegue, migraciones, seeds ni escrituras sobre datos: el
runtime sigue con las imágenes de Fase 3B y el panel en el navegador continúa
bloqueado hasta que se autorice reconstruir. Pruebas herméticas: backend 24,
restaurante 63, cliente 120; TypeScript sin emisión sin diagnósticos.
Detalle: [`FASE_3B_RESTAURANTE.md`](FASE_3B_RESTAURANTE.md).

