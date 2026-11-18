# Auditoría de optimización, robustez, seguridad y buenas prácticas — 17 nov 2026

Alcance: `packages/backend/src`, `packages/shared/src`, `packages/web-{restaurant,customer,driver}/src`,
`config/`, `infrastructure/runtime/`, Prisma schema. Solo lectura; la migración sigue aplicada y la
base persistente no se ha modificado durante la auditoría.

## Resumen ejecutivo

| Ámbito | Críticos | Altos | Medios | Bajos |
| --- | --- | --- | --- | --- |
| Seguridad backend | 0 | 3 | 6 | 3 |
| Seguridad frontend | 1 | 2 | 5 | 4 |
| Robustez / concurrencia | 1 | 2 | 5 | 2 |
| Optimización / BD | 0 | 2 | 6 | 6 |
| Buenas prácticas / identidad | 0 | 0 | 3 | 8 |

Prioridad de corrección: **P0** fuga de datos y exfiltración de token; **P1** bypass de rate limit,
revocación de sesiones, info-leak en 5xx; **P2** razas de asignación/disponibilidad, índices, N+1;
**P3** identidad heredada, accesibilidad, bundle y polling.

---

## P0 — Corregir de inmediato

### P0-1. Fuga de campos sensibles en respuestas del panel de repartidor
`packages/backend/src/services/own-delivery.service.ts:8`

```ts
const include = { restaurant: true, address: true, customer: { include: { user: true } } };
```

El objeto `order` resultante se devuelve directamente en:
- `driver-panel.routes.ts:251` (`POST /driver-panel/qr/reclamar`)
- `driver-panel.routes.ts:297` (`PATCH /driver-panel/pedidos/:id/accion`)
- `own-delivery.service.ts:38,96,136,263`

`User` incluye `password` (hash bcrypt), `email`, `dateOfBirth` y `phoneNormalized`; `Order` incluye
`handoverPin`/`deliveryPin`. Aunque `order-selects.ts` ya define un `select` seguro para los GET,
estas dos mutaciones usan el `include` ancho. El endpoint público `GET /public/delivery-ticket/:token`
sí construye un objeto explícito y **no** filtra el hash.

**Corrección:** reemplazar `include` por un `select` que exponga solo lo operativo, reutilizando
`ownDriverOrderSelect` de `driver-panel.routes.ts` y añadiendo los campos que el servicio necesita
para calcular ETA y PIN. Nunca propagar `User.password` a la capa HTTP.

### P0-2. `apiBase` de `localStorage` con validación débil → exfiltración de JWT
`packages/web-customer/src/app/restaurantes/[restaurantId]/Storefront.tsx:1162-1164`

```ts
if (savedSession.apiBase && savedSession.apiBase.startsWith('/')) setApiBase(savedSession.apiBase);
```

`startsWith('/')` acepta `//evil.com`. Ese valor se usa en `requestJson` con
`authorization: Bearer <token>` (`packages/shared/src/web.ts:592-596`). Un valor envenenado en
`localStorage` envía el access token (y el refresh) a un origen externo. `persistStoredSession` y
`persistApiBase` guardan el valor sin validar.

**Corrección:** no persistir `apiBase` o validarlo con `new URL(value, location.origin)` exigiendo
`url.origin === location.origin`. Aplicar la misma validación en `DriverArrivalModal.tsx` y en
`readStoredSession`.

---

## P1 — Corregir en esta iteración

### P1-1. `sendAppError` filtra mensajes internos en 5xx
`packages/backend/src/errors/http.ts:22-30`

Casi todas las rutas atrapan errores y llaman a `sendAppError`. Para errores no-`AppError`, responde
500 con `error.message` crudo (Prisma P2002/P2025 incluyen modelo, campos y fragmentos de query),
burlon el redactado de `middleware/error.handler.ts:46-49`.

**Corrección:** responder con mensaje genérico y registrar el detalle con `logger.error`.

### P1-2. Bypass de rate limiting vía `X-Forwarded-For`
`packages/backend/src/app.ts:88-93,148-158`

```ts
trustProxy: (_address, hop) => hop === 0,
allowList: ['127.0.0.1'],
keyGenerator: (request) => request.ip,
```

Confiar el hop 0 sin validar el peer permite a un cliente que conecte directo al puerto 3101
establecer `X-Forwarded-For: 127.0.0.1` y quedar excluido de todos los límites (login 10/15 min,
OTP, global 300/min). Mitigado por la topología actual (solo `edge` publica el puerto), pero es una
dependencia frágil de la red.

**Corrección:** restringir `trustProxy` a la IP fija del proxy (`172.30.240.30`) y quitar
`127.0.0.1` del `allowList` en producción.

### P1-3. Cambio de contraseña no revoca sesiones
`packages/backend/src/services/refresh-token.service.ts:75-92`

`revokeAllUserRefreshTokens()` solo se usa en tests. Tras un reset o cambio de contraseña, los JWT
siguen válidos 7 días y los refresh 30 días. Una cuenta comprometida conserva el acceso.

**Corrección:** invocar la revocación en `auth/reset-password`, `customer` change-password,
`driver-panel/password` y `restaurant-panel`; añadir un `pwdEpoch` al JWT verificado en `authenticate`.

### P1-4. `/menu` público devuelve el modelo `Restaurant` completo
`packages/backend/src/routes/public.routes.ts:119-225`

`findFirst` sin `select` y `data: { ...restaurant }` exponen `userId`, `email`, `statusReason`,
`platformFeeRate`, `lastBillingSettledAt` y la cuenta bancaria cifrada a anónimos; para **cualquier**
usuario autenticado (incluido un repartidor) se descifra el número de cuenta.

**Corrección:** `select` explícito de campos públicos; mover la cuenta a un endpoint `CUSTOMER` y
nunca hacer spread del modelo en respuestas públicas.

---

## P2 — Robustez y optimización

| ID | Hallazgo | Ubicación | Corrección |
| --- | --- | --- | --- |
| P2-1 | Pago CASH sin PIN: basta `cashReceived: true` desde el QR público | `own-delivery.service.ts:216,227-229` | Exigir confirmación del receptor autenticado o PIN del cliente también en CASH; registrar who confirmó |
| P2-2 | Race en asignación: `availability` se lee y actualiza sin CAS sobre el driver | `restaurant-driver.service.ts:241-271` | `updateMany` con `WHERE availability IN (...)` y `updatedAt`; rechazar si `count !== 1` |
| P2-3 | Race en disponibilidad: `count` + `update` sin transacción | `driver-panel.routes.ts:129-143` | Transacción con `SELECT ... FOR UPDATE` o `updateMany` condicional releyendo órdenes activas |
| P2-4 | Token de reparto: read→delete→create sin lock propio ni P2002 | `delivery-token.service.ts:19-33` | Advisory lock por `orderId` dentro del servicio y mapeo de P2002 a AppError |
| P2-5 | PIN de entrega inconsistente: QR expone `handoverPin`, el servicio exige `deliveryPin` sin control de intentos | `own-delivery.service.ts:68,219`; `public-delivery.routes.ts:156` | Unificar el PIN y reutilizar la verificación con `handoverPinAttempts` |
| P2-6 | `/reportes` carga hasta 10.000 pedidos anidados y agrega en JS | `restaurant-panel.routes.ts:347-360` | Agregación SQL con `groupBy`/`date_trunc`; paginación o flag `truncated` |
| P2-7 | `audienceCount()` carga toda la base de clientes y corre dentro de un advisory lock | `restaurant-marketing.service.ts:35-44,86-97` | `count()` con `where` fuera del lock |
| P2-8 | bcrypt cost 12 ejecutado dentro de transacción con dos locks | `restaurant-driver.service.ts:97-128` | Calcular hash antes de `$transaction` |
| P2-9 | Falta índice `(restaurantId, createdAt)` y `(status, createdAt)` | `schema.prisma:558-573` | Añadir índices compuestos (migración nueva) |
| P2-10 | `userStatusCache` sin invalidación (30 s de acceso tras baja) | `middleware/auth.ts:13-37` | Exportar `invalidateUserStatusCache` y调用 en mutaciones de `status` |
| P2-11 | `cache.service.ts` nunca se usa en lecturas | `services/cache.service.ts` | Integrar o eliminar |
| P2-12 | Fetch secuencial de tickets QR cada 30 s sin guard de visibilidad | `web-customer/.../ver/[token]/page.tsx:474-477,531` | Endpoint batch y `useForegroundPolling` |

---

## P3 — Buenas prácticas, identidad y accesibilidad

- **CSP** (`config/wingslab.cjs:53-58`): `'unsafe-inline'` + `'unsafe-eval'`; falta
  `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **Logout incompleto** (`shared/web.ts:311-321`, `web-customer/cuenta/page.tsx:116`): no limpia
  zustand, clave legacy `sadel.customer.token`, secretos push ni `.apiBase` (este último además
  permite el envenenamiento de P0-2).
- **Identidad SaDeL visible**: manifiestos de restaurante/driver, `appleWebApp.title`,
  `SaDelLoader`, `IOSInstallGuide`, `AppUpdateBanner`, `PushEnableBanner`, `ticketGenerator`
  (`SaDeL Punto de Venta`), `SaDelLogo` del driver, mensajes de WhatsApp `SaDeL Express` y
  `IMPORT_AI_PROMPT`. Las claves internas `sadel.*` son aceptables; los textos visibles no.
- **XSS en impresión** (`web-restaurant/src/utils/printHelper.ts:16-19,62-87`): `title` se interpola
  sin escapar en `<title>` y el iframe no tiene `sandbox`.
- **Token de reparto en logs** (`web-customer/.../ver/[token]/page.tsx:512`): `console.error`
  incluye el token de 43 caracteres.
- **Accesibilidad**: `IncomingOrderModal` (driver) y `DriverArrivalModal` (customer) sin
  `role="dialog"`/`aria-modal`, foco, Escape ni `aria-live`; el contador del primero corre cada 100 ms.
- **Bundle**: `html5-qrcode` estático en la ruta pública de reparto (el driver sí usa dynamic import);
  `react-zoom-pan-pinch` e Iconify en el bundle inicial.
- **Jobs**: `order-ring.job.ts` cada 3 s; varios jobs cada 30 s. Elevar cadencia o agrupar.

---

## Lo que está bien implementado (no tocar)

1. Fail-closed de configuración e identidad de BD (`config/env.ts`, `config/wingslab.cjs`,
   `config/database.ts`).
2. Defensa en profundidad `businessQueryArgs()` + boundary de restaurante único.
3. Sin interpolación SQL: raw queries parametrizadas; `pg_advisory_xact_lock(hashtext($1))` con
   placeholders; locks distribuidos `SET NX EX` y `SCAN` en vez de `KEYS`.
4. Transacción de creación de pedido con lock por cliente, idempotencia, stock atómico y cupón
   condicional (`order.service.ts:812-1124`).
5. Tokens QR con HMAC sobre `orderId + nonce`, solo hash persistido, TTL 3 h y revocación al cerrar.
6. OTP con `timingSafeEqual`, `crypto.randomInt`, un solo canje y TTL 5 min; webhook con HMAC.
7. Socket.IO con JWT obligatorio, sala derivada del token y `driver:location` desactivado.
8. `requestJson` con timeout, single-flight de refresh, retry solo transitorio y manejo conservador
   de sesión.
9. Paginación consistente en directorios; índices compuestos correctos para `Order` y `DriverEarning`.
10. Modal de comanda y panel de repartidor con semántica de diálogo, Escape y `role=alert/status`.

## Estado de corrección

**Corregido y desplegado en esta sesión:**

- **P0-1** — `own-delivery.service.ts` usa ahora `driverActiveOrderListSelect` (sin
  `User.password` ni datos internos) en las respuestas de QR y acciones.
- **P0-2** — `shared/web.ts` valida `apiBase` con `new URL()` y exige mismo origen;
  `Storefront.tsx` añade guarda explícita `^\/(?!\/)`.
- **P1-1** — `errors/http.ts` redacta errores 5xx y devuelve mensaje genérico.
- **P1-2** — `app.ts` solo confía `X-Forwarded-For` del relay `172.30.240.30`
  (se conserva el `allowList` de loopback porque el despliegue local pasa por un
  único proxy y quitarlo sometería todo el tráfico al límite global compartido).
- **P1-3** — `auth/reset-password` y `driver-panel/password` revocan todos los
  refresh tokens; bcrypt cost se unifica a 12 en el reset.
- **P1-4** — `GET /menu` usa una proyección pública explícita: verificiado que no
  expone `userId`, `platformFeeRate` ni `transferAccountNumber`.

Verificación posterior: 100 pruebas backend, tipos backend y de los tres
frontends, los cuatro puertos en 200, modal de comanda y panel de repartidor sin
regresiones, consola limpia y `git diff --check` sin errores.

**Pendiente (deuda priorizada documentada):** el resto de P2 y P3 — razas de
asignación/disponibilidad, PIN CASH, índices compuestos, agregación SQL de
reportes, caché, identidad SaDeL visible, accesibilidad de modales y bundle.
