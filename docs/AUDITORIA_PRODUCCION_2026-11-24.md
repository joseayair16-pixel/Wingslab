# Auditoría de producción — WingsLab (24 nov 2026)

Trabajo local **sin commit**. Alcance: rendimiento de carga, tamaño de imágenes,
limpieza de dependencias y robustez del arranque. Todo lo medido se hizo con
builds de producción (`next build --webpack`) y contenedores reales.

## Hallazgos y resultados

| # | Hallazgo | Antes | Después |
|---|---|---|---|
| 1 | Imágenes frontend infladas (runtime copiaba `node_modules` completo, 1,1 GB) | customer 1,38 GB / restaurant 1,67 GB | **321 MB / 318 MB** |
| 2 | Audio precargado al montar y descargado dos veces | 1.646 KB en 4 peticiones en la primera carga | **0 KB**; tras el primer gesto, 2 peticiones / 41 KB |
| 3 | Primera carga total del comensal | 2.010 KB | **409 KB** |
| 4 | Caché de sonidos inexistente | `public, max-age=0` | `public, max-age=31536000, immutable` |
| 5 | Escáner QR incluido en el bundle de su ruta | librería en el chunk inicial | `import()` dinámico al abrir la cámara (chunk async de 82 KB) |
| 6 | Dependencias sin uso | 3 paquetes muertos en ambos frontends | eliminados, lock actualizado offline |
| 7 | Montajes tmpfs al `.next/cache` anterior | presentes en `compose.yml` | eliminados |

### Causa del error `ERR_EMPTY_RESPONSE` (contexto previo)

Next 16 reinicia el dev server cuando el heap usado supera el 80 % del límite.
Con `--max-old-space-size=1024` ese umbral era ~819 MB y se alcanzaba
compilando el comensal; las peticiones de CSS/JS en vuelo morían con
`ERR_EMPTY_RESPONSE`. El dev pasó a **Turbopack** (grafo en memoria nativa) y
el heap quedó solo como techo de seguridad: pico del contenedor 2.063 MB →
**963 MB**, compilación fría 34,1 s → **6,7 s**.

## Cambios

**Build y runtime**
- `config/wingslab.cjs`: `output: 'standalone'` y cabecera inmutable para `/sounds/:path*`.
- `scripts/wingslab-run.cjs`: inicia `.next/standalone/.../server.js` con `PORT`/`HOSTNAME`; mantiene la autorización y conserva `next start` como fallback para imágenes antiguas.
- `infrastructure/runtime/Dockerfile.customer` y `.restaurant`: copian solo standalone + `static` + `public`.
- `infrastructure/runtime/compose.yml`: se retiran los tmpfs de `.next/cache`.
- `scripts/wingslab-stage-customer.py` y `.backend.py`: se incluye `.cjs` en el allowlist de `packages/shared/src` (bug preexistente: `config/wingslab.cjs` requiere `wingslab-policy.cjs`).

**Audio**
- `packages/shared/src/audio.ts`: MP3 versionados, dedupe de peticiones en vuelo,
  guard de generación tras `reset()`, decodificación al llegar el buffer y
  `preloadOnFirstInteraction()`.
- `packages/web-customer/src/hooks/useCustomerSounds.ts` y
  `packages/web-restaurant/src/app/page.tsx`: precarga diferida al primer gesto.
- `packages/web-restaurant/public/sw.js`: caché v7 y rutas MP3.
- `public/sounds/` de ambas apps: WAV → MP3 v2 (1,6 MB → 84 KB).
- `packages/shared/src/audio.unit.test.cjs`: 2 pruebas nuevas.
- `packages/backend/jest.hermetic.config.cjs`: `module: 'CommonJS'` en ts-jest
  (necesario porque `packages/shared/src/package.json` declara el árbol ESM
  para Turbopack).

**Frontend y limpieza**
- `scripts/wingslab-customer-dev.cjs`: dev sin `--webpack` (Turbopack).
- `packages/web-customer/next.config.js`: bloque `turbopack: {}` obligatorio
  cuando coexiste con un `webpack` config.
- `packages/shared/src/package.json` (nuevo): `{"type":"module"}` para el
  fuente compartido, que es ESM.
- `packages/web-customer/src/app/reparto/ver/[token]/page.tsx`: `Html5Qrcode`
  dinámico con manejo de error.
- `package.json` de ambos frontends + `package-lock.json`: fuera
  `@iconify/react`, `@iconify-json/fluent-emoji-flat` y
  `next-image-export-optimizer`.
- Eliminado `packages/web-customer/src/app/restaurantes/[restaurantId]/page.tsx.bak`.

## Verificación

- Builds de producción de comensal y restaurante: correctos, con standalone.
- **Backend**: 28 suites / 215 pruebas. **Restaurante**: 8 / 78.
  **Comensal + shared**: 11 pruebas.
- Type-check limpio en ambos frontends; `git diff --check` limpio.
- Imágenes `wingslab-customer:standalone-test` y
  `wingslab-restaurant:standalone-test` construidas y arrancadas con el
  launcher real: `/` → 200 y audio con cabecera `immutable`.
- `bash scripts/wingslab-dev.sh all start` tras el cambio de compose:
  3101 / 3102 / 3103 → 200.

## Notas

- Las imágenes de prueba se conservan (no se hicieron limpiezas de imágenes).
- El staging offline necesitó tres artefactos de plataforma ausentes en la
  caché npm local; se descargaron y fue el propio script quien validó su SRI
  contra `package-lock.json`. No cambió ninguna versión ni integridad.
- El tamaño de 1,22 GB que `docker images` mostraba para el backend era
  engañoso: sumaba 69 capas históricas. El rootfs real es 373 MB.
  No requiere optimización.

## Pendiente (decisión, no bloqueo)

- React 18.3.1 con Next 16.3.4: los `peerDependencies` lo permiten y todo
  funciona, pero la documentación de Next 16 recomienda 19.2. Migrar con
  prueba de regresión antes de tocarlo.
- Prueba de recepción push con la app cerrada: requiere dispositivo y
  autorización (el endpoint local VAPID responde `configured: true`).
- Deuda técnica: `web-restaurant/src/app/page.tsx` (~12.000 líneas) sigue
  pendiente de dividir en secciones.
