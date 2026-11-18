# WingsLab — reparto por QR, personalización de productos y cupones

Verificación local: 15 de noviembre de 2026. Complementa `CONTENIDO_MENU_VERIFICACION_20261115.md`.

## Resultado

Las tres verificaciones pendientes quedan **terminadas y comprobadas en navegador**: ciclo de reparto por QR con ubicación y revocación, personalización de productos con grupos de opciones y precios correctos, y cupones con checkout completo.

Se corrigieron **dos errores reales** encontrados durante la comprobación (redondeo de centavos en la interfaz y un fallo del bloqueo de concurrencia al aplicar cupones). No se añadieron funcionalidades nuevas.

## Cómo se verificó sin tocar los datos reales

Las rutas de escritura de pedidos y de reparto solo admiten el pedido ficticio ya entregado. Para no modificarlo ni relajar esa protección, las pruebas de escritura se ejecutaron sobre una **copia restaurada de la base de WingsLab** (`wingslab_verify_20261115_0830`), con el mismo código de backend, las mismas rutas HTTP y las mismas pantallas, y con el navegador apuntando a esa copia. La base principal nunca recibió escrituras.

La copia se eliminó al terminar. La comparación MD5 de **todas** las tablas públicas de `wingslab_local` antes y después es idéntica.

## 1. Reparto por QR, ubicación, entrega y revocación

Ejecutado en Chrome headless con perfil aislado, geolocalización simulada por CDP y bloqueo de orígenes externos.

| Paso | Resultado |
| --- | --- |
| Pedido en `READY` en la copia | Correcto |
| «Generar QR de reparto» en el panel | QR generado, token de 43 caracteres, URL local `http://127.0.0.1:3103/reparto/ver/…` |
| Generar el QR no inicia el reparto | El pedido sigue en `READY` y queda `deliveredByRestaurant = true` |
| Enlace abierto por el repartidor | Pantalla «Recoger pedido #4» con restaurante, dirección y total |
| «Recoger e iniciar reparto» | Persistencia en `IN_TRANSIT` |
| Ubicación GPS | `lastDriverLatitude/Longitude/At` persistidos desde la página real de reparto (19.4331 / −99.1341) |
| «Notificar: ¡Ya llegué!» | `driverArrivedAtCustomer` registrado; la interfaz pasa a «LLEGADA NOTIFICADA» |
| «CONFIRMAR ENTREGA» → «Confirmar entrega y efectivo ficticio» | `DELIVERED`, `paymentStatus = COMPLETED`, total `$163.00` |
| Enlace de reparto tras el cierre | HTTP 404 `TOKEN_NOT_FOUND`: el enlace queda revocado |
| Historial del comensal | Muestra «Entregado» y el historial `IN_TRANSIT` → `DELIVERED` |
| Panel del restaurante | Muestra el pedido entregado |

No se usó el botón de WhatsApp del diálogo del QR ni ningún canal externo.

## 2. Personalización de productos, validaciones y precios

Se sembraron en la copia dos grupos de opciones de prueba sobre el producto `wl_prod_alitas_6`: «Salsa de prueba» (obligatorio, 1 de 1) y «Extras de prueba» (opcional, hasta 2).

| Comprobación | Resultado |
| --- | --- |
| Grupo obligatorio sin elegir | El botón «Agregar al carrito» queda deshabilitado con «Elige las opciones obligatorias» |
| Opción agotada | Deshabilitada y marcada «Agotado» |
| Máximo del grupo opcional respetado | La tercera opción se deshabilita al alcanzar 2 |
| Selección duplicada | HTTP 400 `INVALID_OPTION_SELECTION` |
| Opción ajena al producto | HTTP 400 `INVALID_OPTION_SELECTION` |
| Opción no disponible | HTTP 400 `OPTION_NOT_AVAILABLE` |
| Exceso de opciones sobre el máximo | HTTP 400 `INVALID_OPTION_SELECTION` |
| Precio en el carrito | 2 × $120 + $30 de opciones = $300 por partida |
| Promoción 2×1 de papas | 2 unidades → 1 pagada: $32,50 c/u, $65 de subtotal |
| Indicación especial | Se conserva en el carrito |

## 3. Cupones, promociones y checkout completo

| Comprobación | Resultado |
| --- | --- |
| Porcentaje `VERIFY10` (10 %, máximo 1 por cliente) | Descuento $36,50 sobre $365 |
| Monto fijo `VERIFY20` | Descuento $20 |
| Envío gratis `VERIFYENVIO` | Descuento = $35; $0 si es recoger en tienda |
| Solo primera compra | HTTP 400 `FIRST_PURCHASE_ONLY` (el cliente ya tiene pedidos previos) |
| Compra mínima no alcanzada | HTTP 400 `PROMO_CODE_MIN_ORDER` |
| Cupón expirado | HTTP 400 `INVALID_PROMO_CODE` |
| Cupón agotado | HTTP 400 `PROMO_CODE_EXHAUSTED` |
| Código inexistente | HTTP 400 `INVALID_PROMO_CODE` |
| Checkout en la interfaz | «Cupón VERIFY10 aplicado correctamente», total $408,00 → −$36,50 → **$371,50** |
| Confirmación del pedido | Un solo pedido: subtotal $365,00 + envío $35,00 − $36,50 = **$371,50**; items con opciones guardadas y cupón registrado |
| Notificación al restaurante | Evento `order:created` recibido por la sala del restaurante |
| Reintento con la misma `clientOrderKey` | HTTP 200 `isDuplicate = true`; sigue habiendo un único pedido |

En el panel del restaurante el pedido aparece con «Descuento aplicado −$36,50» y «TOTAL A RECIBIR $371,50».

## Errores reales encontrados y corregidos

1. **Redondeo de centavos en la interfaz de cliente.** El cupón calculaba $36,50 pero la pantalla mostraba «−$37» y «$372». `formatCurrency` en `Storefront.tsx` y `CartDrawer.tsx` forzaba `maximumFractionDigits: 0`; ahora usan el formateador compartido con centavos. Verificado en pantalla: $408,00 / −$36,50 / $371,50.
2. **Fallo del backend al aplicar cupones.** `SELECT pg_advisory_xact_lock(...)` devolvía `void`, incompatible con la deserialización de Prisma (P2010); la transacción se revertía y el checkout fallaba. Se corrigió con un cast a texto, igual que en el módulo de contenido. El mismo patrón ya había sido corregido en campañas.

Tras las correcciones se repitieron las pruebas: 132 pruebas de backend aprobadas en 15 suites, TypeScript sin errores en backend, cliente y restaurante.

## Datos, servicios y estado final

- Base `wingslab_local`: **sin cambios**. 4 pedidos, 5 usuarios, 3 productos, 0 cupones, 0 tokens de reparto, 0 suscripciones push, 0 tokens FCM, 0 grupos de opciones, 0 promociones publicadas.
- Copia temporal `wingslab_verify_20261115_0830`: eliminada. Solo quedan `wingslab_local` y la base de pruebas de migración preexistente.
- Fixtures protegidos y el pedido integral `cmwgzrpnm0047orggilrr3fxu` (SAD-MWGZRPNI-B93WZN, entregado) sin modificar.
- Sin activaciones de pagos, push ni WhatsApp. Sin funciones nuevas.
- Servicios: backend, restaurante y cliente con HTTP 200. PostgreSQL y Redis `healthy` y sin recrear; contenedores originales conservados.
- Imágenes activas: `wingslab-backend:menu-content-20261115-checkoutfix` (`3c33f02196de…`), `wingslab-restaurant:menu-content-20261115-r2` (`8332ce7a3933…`), `wingslab-customer:menu-content-20261115-pricefix` (`9b4c62e4c22e…`). Las anteriores (`:20261115`, `:single-restaurant`) se conservan para rollback.
- Espacio libre: **22,7 GiB**.
- Cambios de código locales, sin commit y sin push.

## Evidencia

`/private/var/folders/bp/fw91jby178j6336lpfmmd84m0000gn/T/opencode/wingslab-final-flows-20261115/`

- `delivery-06.log` y `evidence/delivery-timeline.json`: ciclo QR completo.
- `flows-07.log`, `evidence/negative-options-coupons.json`, `evidence/checkout-db-private.json`: opciones, cupones y checkout.
- `idempotency` en `flows-07.log`: reintento sin duplicado.
- `evidence-live/` y `live-smoke`: prueba de humo sobre la instalación real, con 4 pedidos intactos y centavos visibles.
- `baseline.json` y `final-health.json`: estado inicial y final.

El script `scripts/wingslab-functional-clone.cjs` es la herramienta de verificación reproducible: arranca el backend real contra una base restaurada, sin HTTP público, sin trabajos programados y sin Redis ni notificaciones reales. No forma parte de la aplicación.

## Qué está listo para el rediseño visual

Con estas verificaciones cerradas, la funcionalidad de WingsLab está verificada de extremo a extremo en el entorno local: menú y personalización, checkout con cupones y pagos ficticios, cuenta y consentimiento, campañas bloqueadas en envío, contenido del menú con modales y carrusel, y reparto propio por QR con ubicación, entrega y revocación.

Puede iniciarse el rediseño visual profesional de una sola aplicación de restaurante con un único panel de gestión, reutilizando el código existente: las pantallas actuales (panel, menú, cuenta, checker, contenido, campañas, reportes) ya están verificadas contra el backend real.
