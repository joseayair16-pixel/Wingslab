# Fase 2D — base principal preparada; backend no iniciado

Se ejecutó exclusivamente la autorización de aplicar el baseline y cargar los
fixtures en `wingslab_local`. No se escribió en otras bases, no se hicieron resets,
descargas, reconstrucciones de imágenes ni cambios funcionales o visuales.

## Comprobaciones inmediatamente anteriores a la primera escritura

Todas superadas; cualquier discrepancia abortaba el procedimiento:

- Configuración host: `127.0.0.1:15432/wingslab_local`, usuario `wingslab_local`.
- Servidor SQL real: `172.30.240.10:5432`, PostgreSQL 16.15.
- Marcador UUID único, coincidente con configuración host/container, runtime.env
  y labels del contenedor exclusivo WingsLab. No se publican UUID ni credenciales.
- Contenedor PostgreSQL healthy, solo en `wingslab_2b_internal`, con volumen
  `wingslab_2b_postgres_v1`; identidad de proyecto e instancia comprobada.
- Rol sin superusuario, CREATEDB ni CREATEROLE.
- `public`: 0 tablas y 0 relaciones antes de migrar.
- Un único baseline presente y hash idéntico al validado contra el checksum de
  la migración terminada en la base desechable durante el preflight anterior.
- Hash del seed preparado sin modificaciones.
- Herramientas locales Prisma 5.22.0, motor Darwin arm64 con commit esperado;
  sin archivos `.env` heredados y sin autorización runtime activada.

## Migración real

Baseline: `20261113000000_wingslab_baseline`.

SHA-256:
`9d224f88c79913e55d0057f623af7561907a1f23820ac239f14673a441d85cc3`.

Comando ejecutado desde la raíz, con entorno limpio y URL inyectada únicamente
para la base principal verificada (nunca como argumento visible):

```bash
node node_modules/prisma/build/index.js migrate deploy \
  --schema packages/backend/prisma/schema.prisma
```

Se fijaron `PRISMA_SCHEMA_ENGINE_BINARY` y `PRISMA_QUERY_ENGINE_LIBRARY` a los
motores Darwin locales ya existentes; `CHECKPOINT_DISABLE=1`,
`PRISMA_HIDE_UPDATE_MESSAGE=1` y npm offline. No se utilizó npm install, db push,
migrate reset ni generación/recompilación de imagen.

Resultado: una migración aplicada satisfactoriamente. Se verificó en
`_prisma_migrations`: nombre/checksum correctos, terminada, sin rollback y un paso
aplicado. Después se revalidó el UUID y se comprobaron vacías las 41 tablas de
negocio antes de ejecutar el seed.

## Estructura creada y verificada

- 41 tablas de negocio + `_prisma_migrations`: 42 tablas en public.
- 18 enums, 156 índices y 43 claves foráneas.
- 0 índices inválidos y 0 constraints sin validar.
- El conjunto de tablas coincide exactamente con los CREATE TABLE del baseline.
- `wingslab_identity.runtime` y su UUID permanecen intactos, fuera de public.

Tablas de negocio:

```text
Address, Admin, AuditLog, Billboard, Customer, CustomerBillingSettlement,
DailyStats, DeliveryToken, Driver, DriverBillingSettlement, DriverStats,
FavoriteRestaurant, FcmToken, FeaturedPurchase, MenuCategory, NotificationRetry,
OperatingHours, Order, OrderItem, OrderItemOption, OrderMessage, OrderTracking,
PlatformRequest, Product, ProductOption, ProductOptionGroup, PromoCode, Promotion,
PushSubscription, RefreshToken, Region, Restaurant, RestaurantBillingSettlement,
RestaurantStats, RestaurantStoreCategory, Review, StoreCategory, SupportTicket,
SystemSetting, Transaction, User
```

Deriva comprobada en modo lectura, reutilizando los motores locales:

```bash
node node_modules/prisma/build/index.js migrate diff \
  --from-schema-datasource packages/backend/prisma/schema.prisma \
  --to-schema-datamodel packages/backend/prisma/schema.prisma --exit-code
```

Resultado: `No difference detected`, exit 0.

## Fixtures cargados

Se ejecutó solo `packages/backend/src/scripts/wingslab-seed.ts`, con
`WINGSLAB_DATABASE_URL` y `WINGSLAB_IDENTITY_DATABASE_URL` fijadas ambas a
`wingslab_local` y UUID esperado fijado desde la configuración verificada:

```bash
node node_modules/tsx/dist/cli.mjs packages/backend/src/scripts/wingslab-seed.ts
```

SHA-256 del seed aprobado:
`68fdc5d8f4e00d46aef459bacd559e895430b5f0faadd73ed88517d98b8008e2`.

| Tabla | Filas |
| --- | ---: |
| Region | 1 |
| User | 4 |
| Admin | 1 |
| Restaurant | 1 |
| MenuCategory | 1 |
| Product | 3 |
| Customer | 1 |
| Driver | 1 |
| Address | 1 |
| Order | 3 |
| OrderItem | 3 |

Total: 20 registros sintéticos. Las otras 30 tablas de negocio están vacías.
Se verificaron valores contra los literales del seed: usuarios por rol con correos
`@wingslab.local`, teléfonos de prueba, región WINGS-LAB, restaurante/dirección
etiquetados ficticios, documento FICT-0001 y referencias WINGS-TEST-001 a 003.
No se importó ninguna fuente de datos externa ni contenido de SaDeL.

Comprobaciones adicionales superadas:

- Estados de pedidos: PENDING, PREPARING, DELIVERED.
- Totales de pedidos e ítems correctos.
- Relaciones pedido/restaurante/cliente/dirección, producto/categoría e
  ítem/producto/pedido consistentes.
- 0 comprobantes de pago, delivery tokens, FCM tokens, Web Push subscriptions o
  registros de reintento de notificaciones.
- WhatsApp desactivado en restaurante y cliente; impresión desactivada.

Las verificaciones SQL posteriores se hicieron con transacciones de solo lectura.
Se corrigieron dos supuestos de las consultas de comprobación, sin tocar datos:
los tokens viven en DeliveryToken, no en columnas de Order, y la dirección inet se
normalizó con host(inet_server_addr()) para evitar el sufijo /32 al comparar.
No hubo reejecución del seed ni de la migración, ni reparaciones destructivas.

## Imagen real, Redis y aislamiento

Se reutilizó sin cambios la imagen Linux/arm64:
`wingslab-backend@sha256:38909b02db294ab0ff8b0220cb07cd0ab58f7c8964b21bc34ae47f34d1bd4ebe`.

Una sonda técnica efímera con esa imagen, configuración readonly y namespace
previsto del backend (172.30.240.21, UID 1000, sin capacidades ni forwarding),
comprobó sin importar el entrypoint:

- Prisma nativo conecta a la base, usuario y servidor principales correctos.
- UUID correcto, conteos de fixtures y consultas con relaciones desde el cliente
  generado; ejecutadas en una transacción explícitamente READ ONLY.
- Redis responde PONG, conserva UUID coincidente y DBSIZE=1 (solo identidad).
- Proveedores externos y todos los grupos de jobs, incluida facturación,
  continúan bloqueados por la imagen compilada.

Se volvió a ejecutar el verificador preparado, sin modificar su topología:

```bash
python3 scripts/wingslab-verify-network.py
```

Resultado: todas las pruebas pasan. Datos propios alcanzables; host, peer externo
simulado IPv4/IPv6, relés desde la red interna y cruces no autorizados entre redes
bloqueados. DNS interno funciona, fixture externo .invalid rechazado. Sin ruta
por defecto ni forwarding en el namespace backend. Solo los dos puertos de datos
están publicados en loopback; 3101–3104 siguen cerrados. Sondas eliminadas al final.

## Condiciones para el primer arranque

Base, fixtures e imagen están preparados para solicitar el primer arranque
controlado. Aún no se verificó /health ni una API servida: el backend NO se inició.

La siguiente autorización deberá incluir exclusivamente:

1. Habilitar el relé de backend y publicar solo `127.0.0.1:3101`, conservando las
   restricciones de interfaz, ICC y forwarding. 3102–3104 permanecerán cerrados.
2. Revalidar ese ingreso con sondas propias y activar solo la autorización backend
   en la configuración local. Las configuraciones frontend seguirán bloqueadas.
3. Arrancar únicamente el servicio explícito backend, sin pull/build ni reiniciar
   dependencias, y comprobar salud, logs sin secretos y rutas API.

Comando preparado, **NO ejecutado**:

```bash
docker --context desktop-linux compose --project-name wingslab-2b \
  --file infrastructure/runtime/compose.yml \
  --env-file infrastructure/runtime/runtime.env --profile approved-backend \
  up -d --no-deps --pull never backend
```

Los flags runtime/networkVerified siguen false. Backend y frontends no tienen
contenedores de servicio creados. Integraciones, notificaciones, facturación y
trabajos automáticos permanecen deshabilitados. Sin commits ni pushes.
