# Fidelidad por compras: diseño de implementación

## Estado verificable de la implementación (17 de noviembre de 2026)

- Se añadieron modelos y migración aditiva `20261117080000_loyalty_cards`.
  El SQL se ejecutó dentro de `BEGIN`/`ROLLBACK` sobre PostgreSQL para comprobar
  sintaxis y referencias. **No está aplicado permanentemente** y no se migraron
  sellos históricos. Prisma valida el esquema.
- `loyalty-ledger.service.ts` prepara el registro idempotente, reservas y
  liberación auditada dentro de una transacción suministrada por el llamador.
  **No está conectado a las rutas de pedidos ni desplegado.** No sustituye pruebas
  de concurrencia real o de los flujos de pago.
- Quince pruebas unitarias de política y helpers pasan. Comprueban también que
  una recogida de reparto no gana un sello y un pedido activo no libera un canje.
- `packages/shared/src/loyalty-card.tsx` es el componente visual común de ambas
  aplicaciones. El panel usa el logo de perfil con fallback; el cliente aún usa
  el wordmark oficial empaquetado. Falta unificar el logo desde la respuesta del
  programa. La página de cuenta ya muestra sellos, no puntos.
- El rediseño y componente visual están desplegados en cliente y restaurante.
  Se verificó el panel a 320, 390 y 1440 px con 30 sellos y la vista cliente con
  datos visuales aislados a 390 px. No se cambió la configuración real para probar.
- **El canje sigue deshabilitado**: faltan integración checkout/preview, reglas
  versionadas persistidas, migración histórica, producto automático/inventario,
  resolución de todas las transiciones y pruebas completas antes de activarlo.

## Acuerdo funcional

- Una tarjeta tiene una meta configurable y una recompensa: descuento fijo,
  porcentaje o un producto específico del catálogo sin costo.
- El beneficio se aplica en el pedido que completa la tarjeta: con meta de
  ocho, el cliente necesita siete pedidos elegibles completados antes de crear
  el octavo. El octavo recibe la recompensa y sella la tarjeta solo al terminar.
- Un pedido cancelado o rechazado no gana sello. Si el pedido premiado se cancela
  o rechaza, su reserva se libera para un nuevo intento; un pedido aún activo
  conserva su reserva y no permite usarla de nuevo en otro pedido.
- No se combina el beneficio de fidelidad con cupones ni otras promociones.
- El producto gratuito se agrega automáticamente como una unidad identificable;
  debe estar disponible, tener inventario cuando corresponda y no generar un
  cargo oculto por opciones. Si no puede añadirse, se explica al cliente y no se
  consume la recompensa.
- Las tarjetas en curso conservan una copia de la meta y recompensa con las que
  comenzaron. Las modificaciones se aplican a tarjetas nuevas; los beneficios
  ya obtenidos no se eliminan por cambios posteriores de configuración.
- Los sellos existentes se respetan: proceden de pedidos elegibles existentes
  desde `stampStartsAt` y cada pedido solo puede contabilizarse una vez.
- Si al iniciar el nuevo sistema un cliente ya tiene diez sellos con una meta de
  ocho, conserva un premio para su próxima compra y dos sellos para el siguiente
  ciclo. La migración debe conservar también cualquier otro progreso completo o
  parcial, sin marcar premios como canjeados sin evidencia.

## Estado actual y brechas

El programa actual se guarda en `SystemSetting`; `/customer/lealtad` calcula
sellos al consultar pedidos y declara `redemptionEnabled: false`. No hay ciclos,
asignaciones ni reservas persistidas. La pantalla de cuenta muestra puntos y el
modal muestra sellos, por lo que hoy no representan una tarjeta canjeable.

El checkout calcula promociones en `order.service.ts` y el frontend calcula una
vista previa independiente en `Storefront.tsx`. No se debe aplicar una recompensa
solo en el navegador ni modificar el total sin actualizar el resumen del pedido,
comprobantes, comandas y reportes. El cálculo final debe ser del servidor y la
vista previa debe dejar claro que está sujeta a validación al confirmar.

## Persistencia e integridad necesarias

1. Versionar las reglas y almacenar una instantánea por ciclo de cliente, sin
   reescribir tarjetas en curso. Las recompensas de producto deben referenciar un
   producto del restaurante, no texto libre ni un precio enviado por el cliente.
2. Registrar sellos con una restricción única por pedido elegible y registrar la
   reserva/canje con unicidad por ciclo y pedido. Contabilizar solo una de las
   rutas de finalización válidas: entrega o recogida completada.
3. Crear la reserva dentro de la transacción del pedido, bajo el bloqueo por
   cliente existente y después de comprobar idempotencia. El subtotal, descuento,
   inventario y la reserva deben confirmarse o revertirse conjuntamente.
4. Resolver de forma idempotente cada transición final, incluidas rutas de
   restaurante, repartidor y cliente: completar confirma el sello y el canje;
   cancelar o rechazar libera la reserva. Deben cubrirse carreras y reintentos.
5. Migrar los sellos históricos sin alterar pedidos, con ejecución idempotente y
   comprobación previa del volumen y de las reglas vigentes. Los clientes que ya
   alcanzaron o superaron la meta necesitan un tratamiento explícito y verificable:
   no se deben descartar sellos ni suponer que ya recibieron premios.
6. La desactivación, cambio de reglas, indisponibilidad del producto, modificación
   de carrito, pago pendiente, cancelación y operaciones simultáneas deben tener
   estados visibles y pruebas. Una respuesta incierta no debe volver a enviar
   automáticamente un pedido.

## Experiencia

El restaurante configura meta, tipo, valor o producto y condiciones en una
pantalla con vista previa de la tarjeta. El cliente ve la misma tarjeta, el logo
vigente, progreso y explicación de cuándo se aplicará el premio. En checkout se
muestra la recompensa antes de confirmar, su descuento o producto y el total
validado; no se promete que una reserva ya es un sello completado.

## Pruebas mínimas antes de activar

- Historial previo, primer ciclo, múltiples ciclos y cambio de reglas en curso.
- Compra premiada, doble clic, concurrencia, reintento idempotente y fallo de red.
- Cancelación, rechazo, pago no confirmado, entrega, recogida y doble transición.
- Producto agotado, eliminado o con opciones, modificaciones de carrito y cupones.
- Totales y comanda coherentes, sin descuentos negativos ni superiores al subtotal.
- Verificación de migración y pruebas aisladas sin modificar cuentas reales.
