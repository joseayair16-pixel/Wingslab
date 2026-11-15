# Fase 3B — panel restaurante funcionando, autenticación y lecturas verificadas

URL: **http://127.0.0.1:3102**.

## Recursos y arranque

- 0 descargas. 182 paquetes locales verificados contra el SRI del lockfile.
- Reutilizados Node oficial, SWC y Sharp previamente aprovisionados.
- Build Next 16.3.4/TypeScript/webpack íntegramente con RUN --network=none.
- Se reutilizó el staging revisado con rol explícito restaurant; no instala en
  node_modules del host ni copia configuraciones/secretos/datos de otros roles.
- Imagen final fijada:
  `wingslab-restaurant@sha256:dd4c8189bcdf0a588f3a9d33a13f0ab2348af40656a13f3e61d6a1ac18bf0fd4`.
- Servicio independiente approved-restaurant, UID 1000, readonly, cap_drop ALL,
  no-new-privileges, sin forwarding e IPv6 desactivado. Solo red interna .23;
  configuración readonly de rol restaurant sin credenciales backend, permisos 0600.
- Edge añadió únicamente 127.0.0.1:3102, escuchando en 172.31.240.10. Se conservan
  publicaciones ya autorizadas; driver 3104 cerrado. Backend/cliente/PG/Redis
  conservaron IDs y StartedAt: no se reiniciaron.

## Correcciones imprescindibles

1. next.config.js declaraba resolve.alias como propiedad Next de nivel superior.
   Se corrigió al callback webpack, resolviendo shared desde su fuente revisada.
2. Al abrir con el fixture PENDING vencido, el frontend intentó PATCH de rechazo
   automático. El navegador de prueba bloqueó ambas solicitudes (incluido reintento)
   antes de enviarlas y se detuvo el restaurante. No hubo cambios en el pedido.
   Se desactivaron los temporizadores de decisión automática y las acciones de
   estado de pedido mediante una guarda explícita WINGSLAB_READ_ONLY de Fase 3B.
   También se bloqueó la suscripción push al inicio de su función y su banner
   mediante la política externa deshabilitada. No se retiró ninguna protección.
   Se reconstruyó únicamente el restaurante offline con estas correcciones.
3. Settings devuelve una imagen externa de bienvenida por defecto. La CSP la
   bloqueaba (sin respuesta externa), pero Network registraba el intento, aunque
   no llegaba al interceptor Fetch. Se detuvo restaurante, se filtraron URLs de
   bienvenida/promoción a rutas locales u orígenes loopback permitidos, usando la
   imagen local ya existente como fallback. Se reforzó el verificador para incluir
   intentos bloqueados por CSP. Build final offline y recorrido repetido: cero
   orígenes externos, incluso en los intentos. Simulación local de pedidos también
   bloqueada en la fase readonly; no se usó para fingir pedidos recibidos.

La guarda de Fase 3B protege acciones de pedidos, no constituye un permiso SQL
general de solo lectura ni deshabilita todo botón de edición de catálogo. Las
pruebas no pulsaron controles de edición, borrado, cierre de negocio o cambios de
estado. Para ensayar transiciones se requerirá autorización y cambiar esa guarda
de forma deliberada; no basta con pulsar Aceptar.

## Pruebas en navegador real

Chrome instalado localmente, perfil nuevo aislado y CDP por pipe. No hubo descarga
de navegador o librerías de automatización. Credenciales obtenidas exclusivamente
del seed sintético local y nunca impresas; no se guardan frames JWT ni headers de
autorización en evidencia. Contactos y contraseñas redactados en la salida final.

El interceptor permitió GET/HEAD/OPTIONS y solo POST auth/restaurant-login o
auth/refresh. Bloquea otras escrituras e intenta detener restaurante si observa
solicitudes inesperadas. Permite solo orígenes loopback 3101 y 3102 y recursos
data/blob; resolución externa deshabilitada. Tras corregir auto-rechazo, el
recorrido final no intentó peticiones fuera de esa lista ni mutaciones de negocio.

Resultados reales:

| Prueba | Resultado |
| --- | --- |
| Login desde formulario con cuenta sintética | correcto; sesión RESTAURANT |
| Perfil/pedidos/productos/categorías con su token | 200 |
| GET pedidos sin sesión | 401 |
| GET metrics administrativo con rol RESTAURANT | 403 |
| Panel de pedidos activos | PENDING y PREPARING visibles |
| Filtro Entregados / Recogidos | fixture DELIVERED visible |
| Mi Tienda | 3 productos y 1 categoría visibles |
| Refresh de pedidos con fallo de red inyectado en navegador | error de sincronización visible |
| Actualizar tras retirar fallo | datos recuperados |
| Socket.IO WebSocket a backend loopback 3101 | conexión y autenticación correctas |
| join-room restaurante | frame enviado y membresía confirmada en log servidor |
| Heartbeat Socket.IO | ping/pong observado |

No se emitieron eventos de creación o cambio de pedido para fingir tiempo real.
Se comprobó conexión autenticada, sala y heartbeat, no aún actualización de pedidos
entre cliente y restaurante. El login legítimo crea refresh tokens de prueba y
Redis usa caché/rate-limit, escrituras de sesión autorizadas en esta fase.

## Carga, errores y límites de presentación

Al retrasar el GET de pedidos, el dashboard muestra temporalmente datos por
defecto: restaurante suspendido y cifras cero, en vez de una carga inequívoca.
Al fallar la red aparece «Sincronización incompleta», pero también se muestran
valores por defecto hasta que Actualizar recupera los datos reales.
Es un defecto de UX existente, no un cambio SQL de estado: la base siguió ACTIVE.
Se documenta sin rediseñar la interfaz en esta fase.

La página de login del panel se prerenderiza estáticamente: no afirmar consulta
SSR de datos autenticados. Los GET de la sesión usan exclusivamente el backend
WingsLab en loopback. Se verificó además `/api/health` 200 y el rewrite generado
fijado a http://172.30.240.21:3101/:path*. No existe fallback a servicios SaDeL.

## Integridad y aislamiento final

- Consulta SQL posterior READ ONLY: UUID correcto; exactamente los mismos 3
  pedidos en PENDING, PREPARING y DELIVERED, cada uno updatedAt=createdAt.
  Productos=3, usuarios=4, restaurante ACTIVE y settlements=0.
- PG/Redis healthy, backend /health 200; frontend cliente conserva HTTP200.
- Logs finales restaurante/backend sin ERROR crítico ni secretos configurados.
  El fallo inyectado es exclusivamente de la petición de prueba en navegador.
- Reejecutado `python3 scripts/wingslab-verify-network.py --running-restaurant`:
  todas las pruebas pasan. No ruta por defecto ni forwarding, IPv6 apagado;
  DNS interno correcto, fixture externo rechazado; host/peers IPv4/IPv6 y cruces
  no autorizados entre redes bloqueados. LAN no alcanza puerto 3102.
- La red interna sigue siendo compartida con PG/Redis propios: no es una ACL
  entre miembros WingsLab. El panel no recibe credenciales SQL/Redis y solo se
  observaron peticiones API a WingsLab. Snapshot TCP sin destinos inesperados.
- No se modificó Docker global, firewall macOS, recursos SaDeL, schema o seed.
  Sin Android, driver, proveedores externos, pagos ni jobs habilitados.

Evidencia sanitizada en directorio temporal propio
`wingslab-3b-vvze5pxt/browser-check-safe`. El perfil Chrome es efímero de prueba,
no un perfil personal; contiene la sesión local y no debe publicarse.

## Comandos seguros desde la raíz

```bash
docker --context desktop-linux compose -p wingslab-2b \
  -f infrastructure/runtime/compose.yml \
  --env-file infrastructure/runtime/runtime.env \
  --profile approved-2b --profile approved-backend --profile approved-restaurant \
  up -d --no-deps --pull never restaurant

docker --context desktop-linux compose -p wingslab-2b \
  -f infrastructure/runtime/compose.yml \
  --env-file infrastructure/runtime/runtime.env \
  --profile approved-2b --profile approved-backend --profile approved-restaurant \
  stop restaurant
```

## Fase 3C — acciones manuales y sincronización (código preparado, sin desplegar)

Implementado en el repositorio, **sin build ni despliegue**: las imágenes en
ejecución siguen siendo las de Fase 3B, por lo que el panel en el navegador
continúa bloqueado hasta que se autorice reconstruir.

### Separación de capacidades

`packages/shared/src/wingslab-order-policy.js` define tres banderas
independientes, todas cerradas por defecto salvo la lista explícita:

- `AUTHORIZED_MANUAL_ORDER_IDS`: solo el pedido ficticio de la prueba
  integral. Los tres fixtures originales y cualquier otro pedido quedan fuera.
- `AUTOMATIC_ORDER_DECISIONS_ENABLED = false`: rechazo automático, auto-aceptación
  y cualquier decisión automática siguen desactivados.
- `SIMULATED_ORDERS_ENABLED = false`: los pedidos simulados del panel no se crean.

Acciones manuales permitidas, ligadas a su estado de origen:
PENDING→Aceptar, CONFIRMED→Iniciar preparación, PREPARING→Marcar listo.

### Validación en backend

`packages/backend/src/config/order-actions.ts` se aplica como hook previo a las
mutaciones de `/restaurant-panel/pedidos/:id/...`:

- Requiere runtime verificado (perfil container con identidades verificadas).
- Solo el pedido de la lista explícita acepta mutaciones; el resto responde
  403 `WINGSLAB_ORDER_ACTION_BLOCKED` antes de tocar el negocio.
- Se conservan JWT, rol RESTAURANT, restaurante ACTIVE y propiedad del pedido.
- `updateOrderStatusByRestaurant` exige el estado de origen exacto y actualiza
  con `updateMany` condicional a `status` y `updatedAt`: un doble clic o dos
  peticiones concurrentes producen 409 en lugar de una segunda transición.
- El evento `order.status_changed` se emite después del commit, no dentro de la
  transacción.

### Sincronización

- La ruta emite el evento a la sala `RESTAURANT:<usuario del restaurante>`: solo
  las pestañas del propio restaurante lo reciben, nunca otro.
- El panel escucha `order:accepted`, `order:preparing` y `order:ready` y vuelve a
  leer la lista completa en lugar de confiar en un payload parcial.
- `packages/web-restaurant/src/lib/order-sync.ts` fusiona la respuesta
  confirmada conservando ítems, dirección y cliente, descarta respuestas más
  antiguas por `updatedAt` y serializa cargas para que una respuesta tardía no
  pise un estado reciente.
- Tras una acción se reconcilia con GET; los fallos de sincronización se
  muestran en un aviso visible con botón «Consultar de nuevo».
- Las mutaciones ya no se reintentan a ciegas: ante error o timeout se consulta
  primero el estado real y, si no se puede confirmar, el pedido queda marcado
  como incierto y no se ofrece otro intento hasta reconciliar.
- No hay actualizaciones optimistas de estado: la interfaz solo refleja lo que
  el servidor confirmó.

### Pruebas ejecutadas

Sin red, sin base de datos real y sin tocar datos:

- `packages/backend`: 24 pruebas herméticas en 5 suites, incluidas las nuevas
  de permisos, transición, sala propia y no-reintento.
- `packages/web-restaurant`: 63 pruebas en 4 suites, incluidas las nuevas de
  fusión, descarte de respuestas antiguas, puerta de sincronización y bloqueo
  de doble clic.
- `packages/web-customer`: 120 pruebas sin regresiones.
- TypeScript sin emisión: backend y restaurante sin diagnósticos (mapeando
  `@sadel/shared` a su fuente, porque `packages/shared/dist` solo existe dentro
  de las imágenes).

### Pendiente de validación en navegador

Requiere reconstruir las imágenes de backend y restaurante, lo que no está
autorizado y con 7,5 GiB libres conviene planningar:

1. Panel autenticado: PENDING muestra solo «Aceptar», CONFIRMED solo «Iniciar
   preparación», PREPARING solo «Marcar listo».
2. Acción real con el pedido autorizado: estado persistido, aviso al cliente y
   actualización de la tarjeta sin recargar.
3. Segunda pestaña del mismo restaurante: se sincroniza por Socket.IO.
4. Doble clic: una sola transición; la segunda recibe 409.
5. Timeout simulado: aviso de sincronización, sin reintento automático.
6. Un fixture original: el panel no ofrece acciones y la API responde 403.

## Fase 3C desplegada — panel y backend actualizados

Recuperado el motor tras el incidente de almacenamiento, reconstruidos **solo**
backend y restaurante con dependencias locales verificadas y `buildx --network
none` (sin descargas), y actualizados únicamente esos dos contenedores.

- Backend `wingslab-backend@sha256:cd2ac48f…`; su build ejecutó las 5 suites
  herméticas (24 pruebas) dentro de la imagen. Salud: ok / healthy / healthy.
- Restaurante `wingslab-restaurant@sha256:cc45e0f4…`; build Next sin red.
- PostgreSQL, Redis, edge y cliente no se recrearon (mismo ID y StartedAt).
- WINGSLAB-E2E-01 intacto: PREPARING, 15 min, $163, pago PENDING, 3 histories.
- Guard activa: una mutación sobre un pedido no autorizado responde 403
  `WINGSLAB_ORDER_ACTION_BLOCKED` antes de tocar el negocio.

Validación en navegador real (Chrome aislado, sin ejecutar ninguna acción):
botones correctos por estado (#04 PREPARING → «Marcar listo»; fixture PENDING sin
botón por la lista blanca), cero PATCH emitidos, actualización de la lista sin
recargar la página, aviso de error de sincronización con «Consultar de nuevo» y
recuperación efectiva, sin excepciones ni peticiones externas.

Dos defectos detectados y corregidos durante la validación: el modal de aceptación
se abría antes de evaluar la autorización (ahora los controles solo se pintan para
pedidos autorizados) y el botón de recuperación solo refrescaba pedidos, dejando
el panel en error (ahora recarga el panel completo).

Rollback disponible: las imágenes anteriores (`wingslab-backend:2c`,
`wingslab-restaurant:phase3b`) siguen en el daemon; basta restaurar su digest en
`runtime.env` y repetir `up -d --no-deps --pull never`.
Siguiente tarea: [`TAREA_REPARTO_QR.md`](TAREA_REPARTO_QR.md).

## Para probar un pedido completo

Hace falta autorizar explícitamente creación y cambios de estado sobre pedidos
sintéticos, revisar/habilitar solo esas acciones manuales y mantener desactivados
auto-rechazos/jobs/proveedores externos. Validar primero autenticación cliente y
una dirección/ubicación local sin Maps; después crear un pedido nuevo y observar
su recepción real por Socket.IO, aceptación, preparación y eventos de vuelta al
cliente. No utilizar pedidos existentes para ensayos destructivos ni afirmar
flujo completado con solo la conexión Socket.IO.
