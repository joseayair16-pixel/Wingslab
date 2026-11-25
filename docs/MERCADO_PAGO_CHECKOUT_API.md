# Checkout API de Mercado Pago — WingsLab

Alcance inicial: una cuenta vendedora en México, MXN, tarjeta de crédito o débito en un pago y efectivo como alternativa. No se habilita transferencia manual, Checkout Pro ni cobros reales en esta etapa.

## Preparar la cuenta

1. En [Tus integraciones](https://www.mercadopago.com.mx/developers/panel/app), crea una aplicación de **Checkout API** para la cuenta receptora del restaurante.
2. Consulta el flujo de pruebas de **Orders API** para esa aplicación. La [referencia de creación de órdenes](https://www.mercadopago.com.mx/developers/es/reference/online-payments/checkout-api/create-order/post) indica usar las credenciales de una cuenta vendedora **de prueba** para sandbox, no las credenciales reales del restaurante. Usa un comprador y tarjetas de prueba según la guía del producto.
3. No compartas tokens ni claves por chat o Git. Solo la clave pública del SDK se entrega al navegador. Guarda el Access Token y el secreto de Webhooks solo en el backend. No registres datos de tarjeta, tokens de tarjeta ni respuestas crudas del proveedor.
4. La ruta de pruebas es `POST /webhooks/mercado-pago/orders`. Está desactivada por defecto. Para validarla en sandbox hacen falta las migraciones aplicadas, una URL HTTPS pública de pruebas y las variables privadas `WINGSLAB_MP_SANDBOX_ACCESS_TOKEN` y `WINGSLAB_MP_SANDBOX_WEBHOOK_SECRET`, además de `WINGSLAB_CHECKOUT_SANDBOX_ROUTES=true`. `localhost` no recibe notificaciones del proveedor.

## Estado de implementación

El servicio interno de reservas y su migración ya existen. El barrido se ejecuta cada minuto solo con `WINGSLAB_CHECKOUT_RESERVATION_SWEEP=true`, después de aplicar la migración. Vence reservas sin enviar, concilia intentos `SUBMITTING` abandonados, entrega el outbox de cocina y reintenta reembolsos. No habilita pagos por sí mismo.

El perfil del restaurante controla los métodos nuevos con `acceptsCash` y `acceptsCard`. El default conserva efectivo y deja tarjeta desactivada hasta que el restaurante la habilite. La migración `20261125100000_restaurant_card_payments` debe aplicarse antes de iniciar el backend con este cambio; añade `Restaurant.acceptsCard` y `CheckoutPaymentIntent.declineReason`. La transferencia queda retirada para pedidos nuevos; sus registros históricos se conservan y se muestran como históricos.

Con las migraciones aplicadas en un entorno de pruebas aislado, `WINGSLAB_CHECKOUT_SANDBOX_ROUTES=true` junto con el barrido activa:
- `POST /me/checkout/card/intents`: reserva el carrito con un `requestKey` UUID calculado en el cliente.
- `GET /me/checkout/card/intents/:id`: estado del intento del comensal autenticado.
- `POST /me/checkout/card/intents/:id/charge`: envía el cobro con un token de un solo uso y la clave de idempotencia del intento.

El formulario usa los Secure Fields individuales de MercadoPago.js y limita el pago a una sola exhibición. El envío de órdenes está habilitado solo para el entorno local explícito con todas las compuertas sandbox activas. El Access Token y el secreto del webhook se configuran únicamente en el backend.

- Intentos separados del pedido operativo, total calculado en el servidor, reserva y clave de idempotencia estable.
- Respuesta incierta: el estado consulta Orders por `external_reference`, con reclamación distribuida limitada a una consulta cada 10 segundos por intento. Si no hay resultado concluyente, conserva inventario; solo un estado terminal confirmado devuelve el stock.
- El webhook verifica firma, consulta la orden con token privado y finaliza una reserva acreditada sin descontar stock otra vez. El outbox durable reintenta la entrega a la cola de cocina después del commit.
- El rechazo de un pedido pendiente, la cancelación del restaurante, la aprobación de cancelación solicitada por el comensal, el rechazo de una programación y el timeout de reparto propio usan un único helper que encola el reembolso total de una tarjeta acreditada en la misma transacción que cambia el estado. La solicitud es única por pedido (`createMany` con `skipDuplicates`), así que carreras concurrentes no generan dos reembolsos. El worker usa una clave idempotente estable y consulta la orden antes de reintentar. Un reembolso en cola no equivale a un reembolso confirmado.
- El reembolso total a través de Orders no lleva cuerpo ni `Content-Type`. El formato sin cuerpo fue confirmado en sandbox; eso no sustituye validar la cancelación operativa en el despliegue.
- El detalle crudo del proveedor no se almacena ni se muestra: `status_detail` se mapea a un código cerrado (`INSUFFICIENT_FUNDS`, `INVALID_CVV`, `EXPIRED_CARD`, `UNSUPPORTED_CARD`, `AUTHORIZATION_REQUIRED`, `TOO_MANY_ATTEMPTS`, `SECURITY_REJECTED`, `GENERIC`). El checkout muestra un modal específico por categoría y permite iniciar otro intento. El mapeo está cubierto por pruebas unitarias; aún no se validó con respuestas reales de Mercado Pago.
- La ubicación GPS no bloquea la tarjeta: la intención no exige `locationVerified` y el formulario intenta geolocalizar de forma best-effort. La dirección se verifica con sus propias coordenadas. El radio, la distancia al domicilio, el monto máximo y el permiso GPS siguen siendo requisitos exclusivos de efectivo; cuando el efectivo no está disponible se muestra un modal que sugiere tarjeta si está habilitada.
- Los cupones y recompensas de fidelidad no se aplican con tarjeta. El checkout lo indica y bloquea el pago hasta que se retiren, de modo que el importe mostrado siempre coincide con el importe cobrado. El total de la orden pagada se calcula en el servidor y se congela en el intento.
- `acceptsCard` se revalúa también al enviar el cobro, no solo al reservar. El checkout funciona con un restaurante solo-tarjeta y el carrito se vacía únicamente después de recibir la acreditación confirmada.

## Validación y entrega al cliente

**Tarjetas guardadas:** la [guía oficial de Orders API para México](https://www.mercadopago.com.mx/developers/es/docs/checkout-api-orders/payment-management/improve-payment-approval/saved-cards) confirma que no hay que migrar a Payments API. El navegador monta el campo seguro de CVV y llama a `mp.fields.createCardToken({ cardId })`. La orden envía el token nuevo y `payer.customer_id`, no el `cardId`. El adaptador prueba ese contrato con una respuesta simulada; el código local añade las rutas, vínculo autenticado e interfaz descritos abajo. La guía consultada menciona Access Token de producción para crear cliente y tarjeta, y especifica un formato especial de correo para usuarios de prueba; confirmar con Mercado Pago qué credenciales admite la bóveda antes de una prueba de guardado. No sustituirlas por credenciales reales del restaurante.

El código local implementa ahora `GET /me/payment-methods/cards`, `POST /me/payment-methods/cards` (requiere `consent: true`) y `DELETE /me/payment-methods/cards/:id`. Se exponen solo con las compuertas sandbox de desarrollo; usan el Access Token sandbox, generan un correo de comprador de prueba determinista y almacenan únicamente `Customer.mercadoPagoCustomerId`. El cobro vuelve a consultar la bóveda para verificar ownership y leer el método de pago antes de crear la orden. El selector solo recibe ID de tarjeta y metadatos mínimos (marca, últimos cuatro y vencimiento). La bóveda de Mercado Pago no se ha probado con credenciales sandbox: la documentación consultada menciona Access Token de producción para crear cliente/tarjeta. Mantener la función de guardado en pruebas manuales hasta confirmar con Mercado Pago el tipo de credencial aceptado; no usar tokens de producción ni tarjetas reales en desarrollo.

El formulario solicita CVV en Secure Fields tanto para una tarjeta existente como al guardar una tarjeta nueva. En el opt-in de tarjeta nueva, el token inicial se envía únicamente para asociar la tarjeta al cliente; luego el SDK crea un token CVV-only con `cardId`, que es el único token enviado al cobro. Sin consentimiento no se llama al endpoint de guardado. No se conservan tokens ni datos de tarjeta en WingsLab. Si falla la respuesta al guardar, el checkout no manda el cobro y pide verificar la lista antes de reintentar.

**Confirmado en sandbox:** captura y tokenización, acreditación de Orders, reembolso total, finalización operativa y entrega única a una cola aislada. El panel mostró el pedido con una respuesta de prueba, no mediante sockets en vivo. El simulador de webhooks llegó a un receptor aislado; no se validó la conciliación del backend desplegado.

**Aún no validado con el proveedor:** la conciliación periódica de intents `SUBMITTING` abandonados y el modal por motivo de rechazo (las categorías se cubren con pruebas unitarias, no con `status_detail` reales). Tampoco se probó un restaurante solo-tarjeta contra la API real.

**3DS:** se verificó el envío de `on_fraud_risk`. Mercado Pago acreditó la orden `ORDTST01M88BRXQW4F15Y0TPNXGH6XEM` sin desafío, aun usando el escenario documentado `APRO-CHOK`. Solicitar al soporte de Checkout API Orders México un caso sandbox que devuelva `action_required / pending_challenge`. Cerrar la prueba solo al completar el desafío y confirmar el estado de esa misma orden, sin imprimir la URL de autenticación. No sustituir la validación con otro pago aprobado sin desafío.

**Webhook y Socket.IO juntos:** `bash scripts/run-sandbox-kitchen.sh --webhook-live` verifica la ruta real de Fastify en PostgreSQL desechable con una respuesta simulada de Mercado Pago. Una entrega sin firma se rechaza; dos entregas firmadas concurrentes crean un solo pedido pagado y un suscriptor de cocina conectado recibe un solo evento `order:created`. Esta prueba no abre el panel ni publica el backend.

### Antes de cobrar para el cliente

1. El cliente debe ser titular de la cuenta **vendedora** de Mercado Pago que recibirá los fondos y de la aplicación Checkout API asociada. El correo del comprador no determina quién recibe el dinero. Verificar la titularidad y las liquidaciones en el panel del vendedor antes de autorizar el lanzamiento.
2. Habilitar un perfil de producción separado mediante un cambio revisado: **no** pegar claves reales en `config/wingslab.local.json` ni reutilizar variables `WINGSLAB_MP_SANDBOX_*`. En el despliegue futuro, la Public Key de la app del cliente será la única clave que reciba el navegador; el Access Token de producción y el secreto de firma vivirán en el gestor de secretos del backend. Rotar cualquier secreto compartido previamente.
3. Registrar la URL HTTPS estable del backend en la configuración de webhooks de esa app, en modo producción. No reutilizar el túnel ni el receptor de diagnóstico. Mantener deshabilitado el cobro hasta validar conciliación, eventos duplicados, pedido único, cocina en vivo, fallos de red y pago rechazado en un entorno aislado.
4. Verificar si Mercado Pago exige Platform ID y OAuth para esta cuenta vendedora única. Usar únicamente un Platform ID asignado por Mercado Pago; no sustituirlo por el ID de la aplicación.

**Esta guía no habilita pagos reales.** El flujo local sirve para desarrollar y probar interfaces con tarjetas sandbox mientras se completan los controles de salida a producción.
