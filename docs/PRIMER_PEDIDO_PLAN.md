# Primer pedido — preparación y autorización pendiente

## Resultado de la preparación

- Backend healthy; PostgreSQL/Redis healthy. Restaurante y cliente activos.
- Lectura SQL: cliente sintético existente ACTIVE, perfil CUSTOMER y una dirección
  activa predeterminada. Restaurante ACTIVE/abierto; región WINGS-LAB activa,
  radio de entrega 8 km. Sin suscripciones push, tokens FCM o settlements.
- El cliente original ya tiene dos pedidos activos: no puede crear un tercero
  sin infringir el límite existente. No cambiar fixtures ni elevar el límite.
- Login cliente existente: POST /auth/login, contraseña bcrypt y rol CUSTOMER;
  crea RefreshToken. Inspeccionado, no ejecutado en esta etapa.
- Registro existente: iniciar OTP email, confirmar y complete-register.
  El simulador funciona solo en test hermético o container con identidad verificada.
  OTP aleatorio de seis dígitos, challenge aleatorio, hash HMAC y comparación
  timing-safe; TTL 300 s, cinco intentos y límites por IP/teléfono.
  Se ejecutó recuperación OTP del cliente sintético: código incorrecto 400 y
  correcto 200. Solo Redis; no se ejecutó reset-password ni registro.
  El código de simulación se entrega al navegador: no es prueba de propiedad de
  un correo real ni un mecanismo admisible en producción. No se publican códigos.
- /public/zonas-activas devuelve WINGS-LAB; catálogo público devuelve el restaurante
  sintético. No se requieren mapas externos para calcular cobertura/distancia.
- Checkout real usa GPS actual para CASH, dirección verificada y radio; se propone
  geolocalización de Chrome explícitamente sintética, sin alterar estas reglas.
- Checkout DELIVERY escribe /customer/addresses/verify antes de /pedidos; creación
  transaccional incluye Order, OrderItem, OrderTracking y Customer.totalOrders.
- clientOrderKey estable, UNIQUE, lock por cliente y respuesta isDuplicate evitan
  crear otra orden al reintentar. Duplicados no vuelven a emitir order:created.
- Eventos implementados: order:created a RESTAURANT; order:accepted y
  order:preparing a CUSTOMER. Las interfaces recargan datos reales tras eventos.
  Todavía no se han observado estos eventos para un pedido nuevo.

## Corrección de carga aplicada

packages/web-restaurant/src/app/page.tsx distingue idle/loading/ready/error.
Mientras consulta: mensaje de carga, sin dashboard de cifras predeterminadas.
Si falla: mensaje de error y Reintentar, no suspensión inferida. Suspensión solo
si status=SUSPENDED; estado desconocido no equivale a cerrado/suspendido.
Un fallo devuelve a dashboard de error para no dejar otras secciones con ceros.
Guarda WINGSLAB_READ_ONLY y auto-rechazos siguen bloqueados.

Build Next/TypeScript offline pasa; siete casos de etiquetas operativas pasan.
Se recreó solo restaurante, sin reiniciar backend/cliente/PG/Redis/edge ni abrir
puertos. Imagen actual:
`wingslab-restaurant@sha256:530490b26fd58dfdf60d38974ea13d08f49677cdd24f666dba77a6566cdfb97a`.
Pendiente verificar los estados nuevos en navegador autenticado después de
autorizar escrituras de sesión. No presentar test de función como prueba de UI.

## Plan de escritura solicitado (aún NO ejecutado)

Cuentas: reutilizar restaurante sintético existente (RESTAURANT); registrar una
cuenta CUSTOMER separada «Cliente Integral WingsLab» con correo reservado
`pedido-integral-01@wingslab.invalid` y teléfono sintético dedicado no usado.
Comprobar unicidad antes; no imprimir teléfono, contraseñas, OTP o tokens.
No usar cuenta admin ni driver. Cliente original y sus tres fixtures preservados.

Rutas autorizables:

1. POST /auth/email-otp/iniciar y /confirmar: challenges/ratelimit Redis, sin correo.
2. POST /auth/complete-register: User y Customer nuevos.
3. POST /auth/login, /auth/restaurant-login y, si necesario, /auth/refresh:
   creación/rotación de sesiones RefreshToken; sin reset de contraseñas existentes.
4. POST /customer/addresses: una dirección sintética propia de la cuenta nueva.
5. POST /customer/addresses/verify: verificación de esa dirección en checkout real.
6. POST /pedidos: exactamente un pedido DELIVERY/CASH de una unidad del producto
   wl_prod_alitas_6, sin cupón, transferencia, uploads o pago electrónico.
   Nota de correlación WINGSLAB-E2E-01, UUID real generado por API y clave de
   idempotencia del flujo cliente conservada. Un reintento idéntico controlado
   para verificar isDuplicate si se autoriza expresamente dentro de esta prueba.
7. PATCH /restaurant-panel/pedidos/ID_NUEVO/aceptar con 15 min y
   PATCH /restaurant-panel/pedidos/ID_NUEVO/preparacion.

Estados: PENDING → CONFIRMED → PREPARING. No declarar entrega completa; no READY,
DELIVERED, cancelación, cobro ni reparto en este alcance. /aceptar configura ETA;
/preparacion usa 15 minutos por implementación actual.

Redis mantiene cola de restaurante y sesiones/rate-limit/caché. SQL solo a través
de rutas reales, salvo lecturas de comprobación. No seeds/migraciones/esquema.
Una cuenta y una dirección nuevas permiten no editar la dirección del fixture.
Productos sin trackStock: no se consume inventario. No borrar después para
conservar trazabilidad. Registrar baseline de fixtures y comprobarlo al final.
Ante timeout consultar pedido/clave antes de reintentar; no generar otra clave.
No repetir automáticamente transiciones ni usar un fixture como sustituto.

Solo tras autorización: habilitar acciones manuales del panel restringidas al ID
nuevo y a aceptar/preparación; mantener auto-rechazos y jobs bloqueados. Comprobar
ambas interfaces simultáneamente, frames recibidos del servidor y GET/SQL posterior,
OrderTracking e historial. No emitir eventos sintéticos para fingir recepción.

## Reutilización y adaptaciones

Reutilizar catálogo, carrito, AuthModal/OTP, direcciones, checkout, idempotencia,
transacciones, roles, seguimiento, ETA y Socket.IO existentes.
Adaptaciones WingsLab: simulador local OTP, ubicación sintética de navegador,
entrada de dirección sin Maps, guardas manuales por pedido y aislamiento de origen.
Registro devuelve access token sin refreshToken: para probar sesión renovable
usar login real posterior; no afirmar refresh de registro verificado.

Repartidor: fase separada con autorización de build/arranque/puerto loopback 3104;
login/rol DRIVER, asignación al pedido nuevo, recogida/PIN, en tránsito, entrega y
sincronización cliente/restaurante, manteniendo proveedores y jobs apagados.
