# Reparto propio por QR — ejecutado

## Resultado comprobado
- WINGSLAB-E2E-01 completó el recorrido mediante controles de Chrome, no mediante mutaciones HTTP manuales: listo, QR, recogida, GPS sintético, llegada y entrega.
- Estado final `DELIVERED`, pago CASH ficticio `COMPLETED`, total $163 MXN; sin movimientos reales de dinero.
- Generar QR conserva `READY`; confirmar recogida cambia a `IN_TRANSIT`.
- Propiedad, allowlist, modalidad DELIVERY, concurrencia y transacciones verificadas. Entrega agrupa estado, historial y revocación. GET no renueva tokens.
- Cliente y dos pestañas de restaurante recibieron eventos reales. Historial de cliente y restaurante muestran la entrega. El enlace consumido responde 404.
- Se conservan exactamente los tres pedidos originales; no se creó otro pedido.
- Pruebas: backend 31, restaurante 63, cliente 120.
- Último despliegue visual completado y validado de nuevo en Chrome: identidad WingsLab, historiales de entrega y catálogo/carrito/checkout sin enviar otro pedido. El carrito persistido se reutiliza sin exigir el botón Agregar cuando ya contiene el producto.
- Imágenes finales: restaurante `sha256:e0298a7f80d0c10653e084d69eaa59dbcfc047f164b8f3c991177dde8f7afdff`, cliente `sha256:64fb6a95ddd29c5ee6289a4b801151638d21b248f4cf6380a9d6f3aa580e26c4`. Backend QR conservado. PostgreSQL, Redis y edge no recreados; espacio tras build 8,26 GiB.
- Evidencia privada: `delivery-verified.json` y capturas dentro de `wingslab-e2e-dd6e4lnd` en el directorio temporal aprobado de OpenCode. No publicar enlaces bearer ni archivos de sesión.

## Acceso local
- Cliente: http://127.0.0.1:3103
- Restaurante: http://127.0.0.1:3102
- Salud backend: http://127.0.0.1:3101/health
- Reparto: enlace del QR generado por el restaurante, sin aplicación ni cuenta independiente.
- Usuarios ficticios: `pedido-integral-01@wingslab.invalid` y `restaurante@wingslab.local`. Las sesiones y credenciales permanecen en el archivo privado de pruebas, no en este documento.

## Límites de la demostración
- Pedido ya entregado: no reiniciarlo ni reutilizar su QR. La allowlist protege los fixtures y no autoriza automáticamente nuevos pedidos.
- Cámara física y teléfono real no probados; enlace QR abierto en Chrome local. Loopback no es accesible desde otro dispositivo.
- GPS de Chrome simulado de forma explícita. Sin navegación externa ni comunicaciones reales durante la prueba.
- Identidad WingsLab aplicada progresivamente; aún existen textos, iconos y folios heredados fuera del recorrido principal.
- Sin migraciones, seeds, commits, push ni cambios en otros proyectos. Imágenes anteriores conservadas.

---
La especificación previa que sigue se conserva como referencia histórica; sus estados y autorizaciones previas ya no describen el resultado actual.

Objetivo: cerrar el recorrido **restaurante → repartidor propio (QR) → cliente** sin
desarrollar una aplicación de repartidor. Se reutiliza la vista de reparto del
cliente (`/reparto/ver/[token]`) y las rutas públicas de ticket de entrega.

## Recorrido esperado
PENDING → CONFIRMED → PREPARING → READY → `asumir-reparto` (IN_TRANSIT) →
`/llegue-restaurante` → `/entregar` (DELIVERED). El cliente recibe
`order:in-transit`, `order:driver-location` y `order:delivered`.

## Piezas existentes a reutilizar (sin tocar)
- `GET /public/delivery-ticket/:token` y `POST .../llegue`, `.../llegue-restaurante`,
  `.../ubicacion`, `.../entregar`, `.../lugar-seguro`, `.../cliente-no-salió`.
- Token determinista HMAC con TTL 3 h (`services/delivery-token.service.ts`).
- `PATCH /restaurant-panel/pedidos/:id/asumir-reparto` (IN_TRANSIT + token y QR).
- `PATCH /restaurant-panel/pedidos/:id/handover` (PIN de traspaso).
- Panel: `qrcode.react` y modal de QR; cliente: escáner `html5-qrcode` o enlace pegado.

## Endurecimientos pendientes (cambios mínimos)
1. `asumir-reparto`: exigir `READY` y `DELIVERY` (hoy salta a IN_TRANSIT desde
   cualquier estado), exigir propiedad y agrupar estado + historial + token en una
   transacción única.
2. Token: no crear ni renovar en `GET` cuando el pedido está cerrado; hoy el token
   es determinista, así que regenerarlo **no invalida** un enlace ya emitido:
   documentar la revocación real (borrado) antes de habilitarlo.
3. Permitir la acción `ready` en el flujo manual (ya existe) y revisar que el paso
   a reparto propio quede cubierto por la lista explícita de pedidos autorizados.
4. `ubicacion`: validar rangos de coordenadas y limitar a pedidos en tránsito.
5. `entregar`: el claim atómico y el borrado del token ya existen; decidir
   explícitamente si `paymentStatus=COMPLETED` (efecto contable ficticio) se
   autoriza en la prueba.
6. Mantener cerrados mapas, enlaces externos, impresión y proveedores: la vista
   muestra dirección y coordenadas, sin Google Maps.

## Pruebas previstas
- Herméticas de rutas: rol/permiso, transición inválida, token expirado o de otro
  pedido, entrega doble (idempotencia), ubicación fuera de rango.
- Navegador: token pegado (sin cámara), llegada, traspaso, entrega; eventos al
  cliente y al restaurante; el QR no sirve para otros restaurantes.
- Confirmar que ninguna otra operación altera los tres fixtures originales.

## Requisitos previos y notas
- WINGSLAB-E2E-01 está en PREPARING: hace falta autorización expresa para
  avanzarlo a READY o para crear un pedido sintético nuevo de la prueba.
- El panel exige hoy sesión RESTAURANT; el repartidor propio opera con el token
  del enlace (posesión), sin cuenta nominativa: decidir si eso basta para el
  alcance acordado.
- Reconstrucción: solo `restaurant` (y `backend` si cambian rutas), con el
  procedimiento ya validado: staging con tarballs verificados, `buildx --network
  none`, pin por digest en `runtime.env`, `compose up -d --no-deps --pull never`.
- Revertir: restaurar el digest anterior en `runtime.env` (imágenes viejas siguen
  en el daemon) y repetir el mismo `up`.
