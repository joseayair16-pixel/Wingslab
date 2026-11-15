# WingsLab: restaurante único — desplegado y comprobado

## Experiencia activa
- Cliente: http://127.0.0.1:3103/ abre directamente el menú, con personalización, carrito, checkout y promociones del propio catálogo.
- Cuenta e historial: http://127.0.0.1:3103/cuenta. Reutiliza autenticación, direcciones guardadas, estados y componentes de pedidos existentes.
- Operaciones: http://127.0.0.1:3102/. Pedidos, menú, configuración y reparto propio QR; sin destacados, facturación de plataforma, directorio ni apoyo a red.
- Enlaces antiguos al único restaurante redirigen a `/`; enlaces a otros negocios no montan menús. El sitemap no descubre negocios.

## Aislamiento aplicado
La identidad controlada está en `packages/shared/src/wingslab-business.js`. No procede de rutas, cuerpos ni parámetros del navegador. El arranque verifica el registro configurado y su reparto propio.

El backend fija el destino de pedidos y cupones, acota consultas y mutaciones comerciales de Prisma —también transaccionales— y rechaza cambios de pertenencia. Categorías y productos enviados se validan contra WingsLab. Las sesiones de otros propietarios y los roles ADMIN/DRIVER no acceden por HTTP ni Socket.IO. La creación de negocios se bloquea también en la capa de datos.

Las rutas de administración multinegocio y del panel de red no se registran. Directorios, altas comerciales, destacados, categorías de plataforma, facturación de plataforma y apoyo/reparto compartido están cerrados en la frontera HTTP. `/settings` ya no consulta configuración comercial de plataforma.

## Verificación
- 247 pruebas: backend 60, cliente 124, restaurante 63. TypeScript sin errores en las tres aplicaciones modificadas.
- Chrome real: menú en la raíz, cuenta con dirección e historial entregado, detalle, enlace antiguo normalizado, URL ajena bloqueada, menú móvil y configuración de reparto exclusivamente propio.
- Navegación sin solicitudes a marketplace, sin excepciones ni mutaciones de pedidos. Pruebas HTTP de manipulación rechazadas con 403/404 antes de escribir.
- Comparación exacta del snapshot comercial antes/después: intacto. Se conservan los cuatro pedidos, incluidos los tres fixtures y WINGSLAB-E2E-01 entregado. No se creó otro pedido.
- Evidencia privada en el directorio temporal aprobado: `wingslab-single-restaurant-evidence/verified.json` y capturas; red y snapshots detallados en `wingslab-e2e-dd6e4lnd`. No publicar sesiones ni enlaces bearer.

## Estructuras internas conservadas, no funcionalidades activas
- Modelo `Restaurant`, claves `restaurantId`, relaciones de clientes/pedidos/productos/cupones, roles y tablas históricas. No hubo migraciones ni borrado de datos.
- Código original de marketplace conservado como referencia en `LegacyMarketplace.tsx`, sin montaje en rutas; tipos reutilizados mediante imports de tipo. Servicios y componentes heredados no accesibles por las rutas de producto no equivalen a un marketplace activo.
- Ruta de compatibilidad `/restaurantes/[restaurantId]`, limitada al único negocio y redirigida a la raíz. No permite seleccionar otro restaurante.
- Nombres técnicos `@sadel/shared`, claves locales de sesión y folios existentes se conservan para no romper sesiones ni reescribir pedidos.
- Textos legales describen la demostración local, no unas condiciones de operación comercial real. El rediseño profesional queda fuera de esta conversión.

## Despliegue y límites
Builds offline, dependencias verificadas y sin descargas. Sustituidos solo backend, cliente y restaurante de WingsLab; PostgreSQL, Redis y edge no recreados. Sin modificaciones a otros proyectos, commits ni push. Rollback conservado; espacio tras build ~6,7 GiB: no iniciar nuevas compilaciones sin revisarlo.

Comprobación final: backend, cliente, cuenta y restaurante responden HTTP 200. Espacio libre observado al cierre ~5,7 GiB; no se ejecutan más builds ni limpiezas con este margen.

Imágenes actuales:
- Backend: `sha256:3f6bd64a1cacb6289851141cdb79d0f20d66a51943784fc10b6393b700e83a7d`
- Restaurante: `sha256:b073cc473e8d22c92c1ed818e5102df549d0fbc8f2ed699d21385b14e1667c3e`
- Cliente: `sha256:5435ef7340e9e1a6b07d3f3db08cf80af74640968403eb75826cb9c5eebecdbf`

La allowlist de operaciones ficticias sigue protegiendo los fixtures. Esta conversión no autoriza nuevos pedidos de prueba, reinicios de pedidos ni cobros o integraciones reales.
