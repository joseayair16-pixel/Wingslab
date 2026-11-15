# WINGSLAB-E2E-01 — ejecución y recuperación

## Resultado actualizado: idempotencia comprobada con un único POST

Después de autorización específica, se reenvió una sola solicitud a POST /pedidos.
No hubo checkout, login/refresh, addresses/verify ni reintentos automáticos.

Antes de enviar se comprobó la clave original contra el único Order correspondiente,
el cuerpo capturado por el interceptor original y su identidad CUSTOMER mediante
GET /auth/perfil. Se reserializó con JSON.stringify, igual que el checkout original,
sin modificar ningún campo, GPS, notas o clave. SHA256 del cuerpo:
`21b8a5aaf257e4e568eb3237eae6218eb4c072bd74034be502379e42163cd891`.
No se presenta el JSON sensible de sesión en el informe.

La imagen en ejecución conserva la salida anticipada por clave/propietario antes
de crear Order, calcular nuevo contador, encolar o emitir notificaciones. Usuario
activo, sin deuda; 23 jobs bloqueados e integraciones externas deshabilitadas.
Docker responde, datos healthy y espacio previo superior a 5 GiB.

Respuesta real: **HTTP200, success=true, isDuplicate=true**.
ID `cmwgzrpnm0047orggilrr3fxu`, folio `SAD-MWGZRPNI-B93WZN`,
estado **PREPARING**, total **163 MXN**: todos iguales al original.

| Comprobación | Antes | Después |
| --- | ---: | ---: |
| Pedidos totales | 4 | 4 |
| Ítems totales | 4 | 4 |
| Tracking total / del pedido | 3 | 3 |
| Ítems del pedido | 1 | 1 |
| Máximo dailyCounter | 4 | 4 |
| Suma dailyCounter | 10 | 10 |
| Folios distintos | 4 | 4 |
| Customer.totalOrders del cliente de prueba | 1 | 1 |
| Emisiones Socket.IO registradas | 3 | 3 |

Snapshot SQL READ ONLY completo antes/después sin cambios para Order, OrderItem,
OrderTracking, Customer, Restaurant, Product, Address y la selección de usuarios.
Incluye los fixtures originales. Cola Redis idéntica; no incrementó el log de
creación, hubo un único log de idempotency hit adicional y exactamente un POST
/pedidos completado adicional. Ninguna emisión de negocio nueva, notificación de
creación, cola de reintentos, cobro o asignación. Solo actividad técnica de
autenticación/lecturas/rate-limit/logs; no confundirla con efectos de negocio.

Preflight del verificador se detuvo inicialmente sin enviar POST: timestamp SQL
sin zona interpretado en horario local y comparación textual del JS compilado.
Se corrigieron solo esas comprobaciones del arnés (timestamp UTC, posición de
const queueInfo en código compilado). No se modificaron aplicación, base o payload.
El marcador local exclusivo se escribió antes del único POST efectivo para impedir
repetirlo incluso si se hubiese producido timeout. No hubo anomalía en la API.

Espacio libre final: aproximadamente **7,5 GiB**. Se detuvo la prueba después de
las comprobaciones. Evidencia privada en wingslab-e2e-dd6e4lnd:
idempotency-response.json, idempotency-verified.json, idempotency-before-counts.json,
baseline SQL privado y marcador idempotency-one-attempt.json. No volver a ejecutar
el script para este pedido.

## Estado actualizado: aceptación y preparación comprobadas

Tras la recuperación autorizada de Docker y la reactivación de los contenedores
existentes, se autorizaron únicamente las dos transiciones por API. Sin builds,
reconstrucciones, migraciones, seeds, frontend edits o nuevos pedidos.

- ID `cmwgzrpnm0047orggilrr3fxu`, folio `SAD-MWGZRPNI-B93WZN`, panel #04.
- PATCH `/restaurant-panel/pedidos/ID/aceptar` con preparationTimeMinutes=15:
  **HTTP200, CONFIRMED**, comprobado por SQL READ ONLY inmediatamente después.
- PATCH `/restaurant-panel/pedidos/ID/preparacion` con cuerpo vacío:
  **HTTP200, PREPARING, 15 minutos**. La ruta usa 15 por defecto, no ofrece un
  campo configurable de preparación. No se simuló otro contrato.
- Historial real: exactamente PENDING → CONFIRMED → PREPARING. Sin cobro,
  entrega o asignación. PaymentStatus=PENDING y total=163 MXN.
- El texto del tracking PREPARING reutiliza «Pedido aceptado…»; el status
  persistido sí es PREPARING. No se cambió ese texto para maquillar resultados.
- Productos, ítems, cliente, dirección, restaurante y modalidad DELIVERY/CASH
  preservados. Cuatro pedidos totales (tres originales + este). Comparación
  completa de los otros pedidos y tracking sin cambios; clientes, restaurantes,
  productos, direcciones e ítems coinciden con el baseline previo a transiciones.
- Clave original y payload capturado conservados; exactamente un pedido con esa
  clave. **No se ejecutó el reintento idempotente** en esta etapa.

### Seguridad comprobada antes de PATCH

UUID correcto, cuentas sintéticas CUSTOMER/RESTAURANT, pedido PENDING y dueño
correcto. Middleware exige JWT, rol RESTAURANT y restaurante ACTIVE; búsqueda
transaccional limita por ID y propietario, y valida transición.

Imagen backend ejecutada: externalServicesEnabled=false, 23 jobs bloqueados y
arranque sin jobs. Restaurante con hasOwnDelivery=true, impresora y WhatsApp
deshabilitados; no suscripciones push/FCM ni cola de reintentos. La cola Redis
no contenía otros pedidos que activar al retirar el autorizado. No se dispara
autoasignación para reparto propio. Guardas de auto-rechazo del frontend intactas.

### Socket.IO e interfaces reales

Servidor registra una emisión `order:accepted` y una `order:preparing`, ambas a la
sala CUSTOMER derivada del usuario ficticio. Frames de ambos eventos recibidos
en Chrome. La instrumentación capturó dos frames por evento; el log servidor
confirma una única emisión de cada uno, no dos cambios de estado. No se emitieron
eventos sintéticos. Ningún evento de esas transiciones llegó a RESTAURANT: la ruta
no notifica la acción al propio restaurante iniciador, coherente con el código.

Cliente mostró preparación y ETA «Llega en 15–23 min» tras los eventos; GET real
desde el cliente confirmó finalmente PREPARING/15. El panel restaurante ya abierto
conservó el estado anterior después de la llamada API externa; al volver a
consultarlo se observó #04 «En preparacion», producto, nota y total correctos.
No afirmar sincronización live entre pestañas RESTAURANT independiente del refresh.
La etiqueta cliente agrupa CONFIRMED/PREPARING; el SQL e historial distinguen ambos.

Problemas de instrumentación: un intento cross-origin desde Runtime.evaluate/CDP
agotó timeout antes de que PATCH u OPTIONS llegaran al backend. SQL confirmó
PENDING, sin tracking nuevo. Las dos operaciones ejecutadas en servidor se hicieron
una sola vez por HTTP directo con el JWT de la sesión real del restaurante; no se
eludió middleware ni se alteró el token. Otro timeout ocurrió en recarga de página
tras aceptación; se comprobó CONFIRMED antes de continuar solo con preparación,
sin repetir aceptar. Se ajustó exclusivamente el arnés para diálogos beforeunload,
actualización mediante control existente y espera del DOM; no se modificó frontend.

Logs contienen dos ERROR «Intento de enviar push sin VAPID configurado», uno por
transición: la función retorna sin enviar al no haber VAPID/suscripciones/tokens.
Son ruido del proveedor deshabilitado, no fallo de PATCH. Sin suscripciones nuevas,
sin reintentos encolados y sin peticiones externas observadas en los recorridos.

### AVOCADOC — solo metadatos

API y DB tienen RestartPolicy=no y RestartCount=0. StartedAt es
2026-11-14T23:26:11Z, posterior al arranque del motor 23:12. No se explica por una
política unless-stopped/always. Docker solo conservaba 256 eventos y el más antiguo
disponible ya era posterior al arranque de AVOCADOC; no había evento start/restart
retenido ni rastro suficiente en los logs de proxy revisados para atribuir actor.
No afirmar quién lo arrancó. No se detuvo, reinició o consultó su información de
negocio; ningún comando de esta prueba lo inició.

### Cierre y siguiente autorización

Backend /health: ok; DB/Redis/Socket.IO healthy. Espacio libre final **7,5 GiB**.
No cambios de infraestructura, limpieza o nuevas compilaciones. Evidencia privada
en `wingslab-e2e-dd6e4lnd`: transition-*-verified.json, transition-events.json,
network-*.json, final-preparing-*.json y final-ui-api-read.json. Baselines y sesiones
privados no deben publicarse.

Procedimiento propuesto para idempotencia, pendiente de nueva autorización:
leer identidad, el pedido y el único registro con su clientOrderKey; verificar
CUSTOMER y cuerpo capturado intactos; enviar una sola vez el mismo cuerpo completo
a POST /pedidos con su clave original y sesión del mismo cliente. No ejecutar
checkout ni addresses/verify, no renovar coordenadas/notas/productos o generar
otra clave. La ruta existente devuelve el registro por clave antes de validar
antigüedad GPS y antes de crear/enqueue/notificar. Exigir HTTP200/isDuplicate=true,
mismo ID/folio/PREPARING y verificar que Order/OrderItem/OrderTracking,
Customer.totalOrders, cola y emisiones permanecen sin aumentos. Si la clave o el
registro no coincide, parar sin enviar. No prometer idempotencia probada hasta
ejecutar este reintento con autorización.

---

Lo siguiente describe la etapa histórica anterior al restablecimiento del motor.

## Resultado comprobado antes del fallo de infraestructura

- Cuenta nueva CUSTOMER registrada mediante OTP simulado real de la API; ningún
  correo enviado. Login de contraseña comprobado por API y formulario cliente.
- Una dirección nueva de esa cuenta creada por API; seleccionada en checkout.
- Checkout real: una unidad Alitas ficticias x6, DELIVERY/CASH, subtotal 120,
  envío 35, servicio 8, total 163 MXN. Geolocalización Chrome explícitamente
  sintética (no ubicación física), sin Maps, con las validaciones GPS originales.
- Nota enviada por la UI: `Tienda: WINGSLAB-E2E-01`.
- Clave idempotente única generada por el mecanismo existente de checkout;
  payload exacto conservado privadamente para reintento, sin generar otra clave.
- ID: `cmwgzrpnm0047orggilrr3fxu`.
- Folio real API: `SAD-MWGZRPNI-B93WZN`; contador de panel **#04**.
- GET /me/pedidos devolvió exactamente una orden del cliente nuevo en PENDING.
- GET /me/pedidos/ID confirmó ID, folio, PENDING, total 163 y nota de correlación.
- Frame WebSocket realmente recibido por navegador RESTAURANT:
  `order:created` con ese ID. No se emitieron eventos sintéticos.
- Panel restaurante muestra #04 / Cliente Integral / $163 en «Por aceptar».
- Cliente muestra «Esperando confirmación del restaurante…». La etiqueta de fase
  genérica «En preparación» aparece incluso mientras el estado API es PENDING;
  no equivale a alcanzar PREPARING. También aparece un aviso de notificaciones
  bloqueadas; no se habilitó ningún proveedor ni suscripción.
- No hubo solicitudes HTTP externas, escrituras inesperadas bloqueadas ni
  excepciones JS sin manejar en los recorridos de creación/inspección guardados.

## Bloqueo y operaciones NO realizadas

Para habilitar únicamente aceptación/preparación manual del ID nuevo se preparó
una guarda específica, conservando todos los auto-rechazos deshabilitados.
La construcción offline falló al copiar el resultado al runtime:

```
write /var/lib/docker/buildkit/containerd-overlayfs/metadata_v2.db: read-only file system
```

No llegó a fijarse/arrancarse esa imagen ni se ejecutaron transiciones. Se retiró
la excepción de código no aplicada: panel fuente y runtime conservan readonly.
No se forzó un estado por SQL ni se evitó la guarda usando otra ruta.

Después del fallo, /health primero devolvió degraded (DB healthy / Redis
unreachable). Más tarde fallaron la consulta SQL posterior por loopback y
/health. Docker system df tampoco devolvió diagnóstico utilizable. No atribuir
esto a falta de disco sin evidencia: solo está confirmado el filesystem readonly.

**PENDING es el último estado comprobado. CONFIRMED y PREPARING no alcanzados.**
No hay order:accepted u order:preparing observados. No se configuraron 15 minutos.

**Reintento idempotente pendiente:** no se envió la segunda creación después de
degradarse los servicios. Solo una creación enviada; no afirmar idempotencia
verificada porque exista una clave en el código.

No asignación, entrega, cobro, cancelación, uploads ni notificaciones externas.
No migraciones, seeds, descargas, despliegues, commits/pushes, limpieza Docker,
reinicio de Docker Desktop ni modificaciones de otros recursos.

## Integridad de fixtures

Antes de escribir se obtuvo baseline SQL READ ONLY con UUID WingsLab verificado:
los tres pedidos originales, direcciones, productos y usuarios originales.
Ninguna petición de mutación de pedidos apuntó a los fixtures. Se usó una cuenta
y dirección nuevas; las acciones automáticas del panel siguieron bloqueadas.

La comparación SQL final NO pudo completarse tras el fallo de almacenamiento;
no afirmar integridad final byte a byte o trazabilidad SQL completa hasta recuperar
la infraestructura y comparar el baseline. Tampoco afirmar salud final normal.

## Interfaz y reutilización

Corrección de carga restaurante compilada/activa antes del fallo: estados
loading/ready/error explícitos, sin mostrar suspensión por falta de perfil; error
con Reintentar y sin cifras predeterminadas en dashboard. Build TypeScript y siete
casos de etiqueta operativa pasan. El estado listo se observó en navegador; falta
prueba autenticada específica de carga/error/suspensión real.

La primera captura de restaurante posterior al evento todavía mostraba solo los
fixtures. Se confirmó recepción del frame; en una sesión posterior, al abrir el
panel, apareció el pedido nuevo. Se reforzó el navegador de pruebas para evitar
throttling de pestañas de fondo, pero NO se atribuye como causa definitivamente
demostrada ni se declara refresco live inmediato completamente validado.

Reutilizado: OTP/challenges, registro, login, perfil, direcciones, catálogo,
carrito, cálculo/validaciones de checkout, POST real de pedidos, clave de intento,
GET de historial/detalle, autenticación Socket.IO y panel de pedidos existente.

Adaptación pendiente WingsLab: alta/dirección desde UI sin Maps para perfiles
nuevos; copy de notificaciones deshabilitadas; fase PENDING inequívoca; comprobar
refresco live inmediato; acciones manuales limitadas al pedido nuevo. Registro
no devuelve refreshToken; login posterior sí. Mantener simulador OTP exclusivamente
local: devolver mockCode no prueba propiedad de un correo real.

## Reanudación segura

Requiere recuperar el almacenamiento de Docker Desktop con autorización separada;
no limpiar imágenes/cachés/volúmenes ni reiniciar todos los servicios sin permiso.
Tras recuperar, verificar identidad/health y comparar baseline antes de escribir.
Consultar el ID y su clave: no repetir registro, no crear otra dirección o pedido.
Reenviar exactamente el payload guardado con la misma clientOrderKey y verificar
isDuplicate, un único Order/OrderItem y ningún tracking/conteo/evento adicional.
Luego habilitar solo aceptar/preparacion de este ID, ejecutar 15 min y comprobar
GET/SQL/tracking, eventos CUSTOMER e interfaces simultáneamente. Si el pedido no
está recuperable, parar; no sustituirlo por un fixture ni generar otro sin permiso.

Evidencia bajo directorio privado temporal propio `wingslab-e2e-dd6e4lnd`:
baseline.json, private-state.json (credenciales/tokens/payload; NO publicar),
network-*.json (sin tokens/frames auth), persisted-order.json, snapshots DOM y logs
sanitizados. Fallo de build en wingslab-3b-vvze5pxt/first-order-manual-build.log.
Los scripts de prueba no son un comando de producción ni deben repetirse a ciegas.
