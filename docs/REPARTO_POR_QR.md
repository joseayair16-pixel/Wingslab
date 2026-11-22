# Reparto WingsLab: enlace/QR sin cuentas de repartidor

La interfaz activa es `packages/web-customer/src/app/reparto/ver/[token]/page.tsx`.
El restaurante genera el enlace y el repartidor confirma recogida, llegada y
entrega. La ubicación se comparte mediante la capacidad limitada del token.

Se retiraron `web-driver`, su inicio de sesión, las rutas `driver-panel`, la
gestión/asignación/pagos de repartidores del panel y su servicio Docker.
Las sesiones con rol DRIVER no son principales autorizados de WingsLab.

## Estructura heredada pendiente

No se han eliminado los modelos Prisma, tablas ni enums históricos de Driver,
DriverEarning y DriverPayout, ni todas las referencias heredadas a repartidores
en servicios generales. Su eliminación física requiere una migración y una
revisión transversal; no debe confundirse con la retirada funcional del módulo.
Las migraciones históricas y los documentos de fases previas se conservan.

La comprobación local del 22 de noviembre de 2026 encontró cero repartidores,
ganancias, pagos y pedidos con driverId asignado. No se borraron pedidos.

## Verificación realizada

- TypeScript: backend, restaurante y comensal.
- 42 pruebas: own-delivery y single-restaurant.
- Backend compilado y reiniciado mediante wingslab-dev.sh.
- Comprobado rechazo de `/driver-panel/perfil` en el servidor local.

No se creó un pedido ni se ejecutó una entrega de prueba.
