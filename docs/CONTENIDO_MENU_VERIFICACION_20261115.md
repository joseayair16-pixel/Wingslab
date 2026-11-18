# WingsLab — contenido del menú y campañas

Verificación local: 15 de noviembre de 2026.

## Resultado y alcance

**Terminado y desplegado:** gestión de modales de bienvenida y carrusel desde el restaurante; presentación en el menú del cliente; vista previa personalizada de campañas, borradores, edición, duplicación, programación y cancelación. Los envíos comerciales siguen bloqueados deliberadamente.

Este cierre corresponde a esta integración. Las verificaciones funcionales que quedaron pendientes (reparto QR/GPS/entrega/revocación, personalización con grupos de opciones y cupones/checkout) se completaron después y están documentadas en `VERIFICACION_REPARTO_PERSONALIZACION_CUPONES_20261115.md`. No se crearon pedidos en la base principal ni se reutilizó el pedido integral entregado.

## Uso

- Restaurante: <http://127.0.0.1:3102> → **Contenido del menú**.
  - **Modales de bienvenida**: imagen, título, descripción, enlace interno opcional y botón; audiencia de todos/visitantes/clientes; vigencia; frecuencia por navegador (sesión, 24 horas o una sola vez); prioridad por orden; activar/desactivar y eliminar.
  - **Carrusel de imágenes**: cargar, editar, ordenar, activar/desactivar y eliminar banners. Vista previa móvil; referencia de formato 960 × 408 px.
- Restaurante → **Campañas**: título y mensaje propios, vista previa de notificación, segmento, destino interno, cupón opcional, borrador/programación e historial. Guardar programación **no ejecuta un envío ni un trabajo automático**.
- Cliente: <http://127.0.0.1:3103>. El contenido activo aparece sobre el menú; el modal se puede cerrar. El carrusel tiene controles manuales, sin rotación automática.
- Cuenta: <http://127.0.0.1:3103/cuenta>. Consentimiento comercial separado del permiso del dispositivo y revocable.

No quedan promociones de prueba publicadas. Los paneles vacíos son el estado final esperado; el dueño debe cargar su contenido.

## Persistencia, seguridad y límites

- Se reutiliza `SystemSetting` con claves exclusivas `wingslab.restaurant.menu-content.v1` y `wingslab.restaurant.menu-image.*`. No se añadieron migraciones ni tablas para este bloque.
- Imágenes locales persistentes en PostgreSQL, normalizadas a WebP. No se descargan imágenes ni se contacta R2, SaDeL u otro proveedor.
- PNG/JPG/WebP hasta 2 MiB; límite de 20 millones de píxeles al decodificar; salida hasta 1600 × 1600 y 400 kB. Máximo 24 piezas y 100 imágenes almacenadas, incluidas cargas abandonadas en el editor. Eliminar una pieza no purga automáticamente su imagen; no se implementó un recolector de imágenes huérfanas.
- Solo el propietario autenticado de WingsLab puede gestionar el contenido. Los enlaces aceptados son internos; no se permite HTML arbitrario ni SVG.
- Filtrado de audiencia y vigencia en backend, sin caché compartida de respuestas por sesión. Actualización del contenido del cliente cada 60 segundos.
- Revisión optimista y bloqueo transaccional evitan sobrescribir cambios concurrentes.
- Como máximo un modal por visita. La frecuencia depende del almacenamiento de ese navegador/usuario, no de una medición global entre dispositivos. Borrar datos del navegador puede permitir otra aparición.
- Push permanece deshabilitado en backend incluso con credenciales. Sin destinatarios elegibles se pueden guardar borradores, pero preparar un envío se rechaza. No hay envío por WhatsApp/SMS ni cobros reales.

## Errores reales encontrados y corregidos

1. PostgreSQL devuelve `void` desde `pg_advisory_xact_lock`, incompatible con la deserialización de Prisma. Se convirtió el resultado a texto tanto en contenido como en campañas.
2. La tabla migrada `MarketingConsent` no tenía permisos para el rol de la aplicación. Tras verificar la identidad WingsLab se concedieron exclusivamente `SELECT, INSERT, UPDATE, DELETE` sobre esa tabla a `wingslab_local`.
   - Operación ejecutada: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."MarketingConsent" TO wingslab_local;`
   - No se cambiaron propietarios, roles globales ni archivos de migraciones ya aplicadas.
3. Duplicar/cancelar/preparar campaña enviaba `Content-Type: application/json` con cuerpo vacío. Ahora estas acciones envían `{}`.
4. Se retiró el bloqueo de guardar borradores por audiencia cero. El bloqueo efectivo de envío permanece.

## Comprobación real en navegador

Chrome local headless, perfil aislado e interceptación que bloquea orígenes externos. Imágenes sintéticas generadas localmente, no con servicios externos.

| Comprobación | Resultado |
| --- | --- |
| Login del restaurante, dashboard/reportes | Correcto |
| Clientes e historial, listado de pedidos sin mutaciones | Consultados en UI |
| Crear modal, cargar imagen, audiencia visitante | Guardado y mostrado al cliente |
| Crear dos banners, cambiar orden, editar título | Guardados y visibles en el orden esperado |
| Activar/desactivar banner | Verificado también contra la respuesta pública |
| Cierre de modal y no repetición en la misma sesión | Verificado en navegador |
| Carrusel siguiente y vista móvil 390 × 844 | Verificado; sin desbordamiento horizontal |
| Ocultar modal de visitantes a cliente autenticado | Verificado contra la respuesta pública autenticada |
| Crear, editar y programar campaña | Persistencia comprobada |
| Duplicar campaña | Copia nueva persistida como `DRAFT`, sin fecha ni envíos |
| Preparar envío sin audiencia | Rechazado, sin cambiar el borrador ni transmitir |
| Cancelar campaña original y copia | Ambas persistidas como `CANCELLED`, `sent = 0` |
| Registro del cliente | Formulario visible; no se completó un registro nuevo |
| Login, cuenta y pedidos del cliente | Correcto |
| Consentimiento | Alta y revocación comprobadas en UI y API; estado final revocado |
| Eliminar contenido sintético | Verificado en UI y API; paneles finales vacíos |

La primera prueba de campañas solo comprobaba clics y fue insuficiente: se descubrió que duplicar fallaba. La evidencia definitiva es `final-browser.log` más `campaigns-persisted-before-cleanup.json`, obtenida después de corregirlo.

Las reglas de fechas, audiencias, rutas, límites, control de acceso, normalización de imágenes y conflictos de edición tienen pruebas unitarias. No se declara aquí una prueba de navegador independiente de cada combinación de frecuencia y fecha.

## Pruebas y datos

- **132 pruebas backend aprobadas en 15 suites** después de las correcciones.
- TypeScript backend, cliente y restaurante: sin errores.
- Compilaciones de producción de ambos frontends completadas offline.
- `git diff --check`: sin errores.
- Se retiraron 3 piezas, 3 imágenes y 2 campañas sintéticas; se conserva la evidencia fuera de la base.
- Comparación MD5 del JSON completo ordenado por ID de `User`, `Customer`, `Order`, `OrderItem`, `Product` y `OrderTracking`: idénticos antes/después. No se modificaron fixtures ni el pedido integral entregado.
- Se conserva el registro de consentimiento de prueba **revocado**. Los inicios de sesión de prueba pueden dejar registros de sesión; no son pedidos ni contenido publicado.

## Servicios, respaldo y migraciones

Estado final comprobado:

- Backend: <http://127.0.0.1:3101/health>, HTTP 200, PostgreSQL/Redis/Socket.IO saludables.
- Restaurante y cliente: HTTP 200 y navegación funcional.
- PostgreSQL, Redis y edge: contenedores originales conservados. No se recrearon ni limpiaron volúmenes o imágenes.
- Imágenes activas:
  - `wingslab-backend:menu-content-20261115-r2` (`e22cf826dda4…`).
  - `wingslab-restaurant:menu-content-20261115-r2` (`8332ce7a3933…`).
  - `wingslab-customer:menu-content-20261115` (`2b583bbcb9ce…`).
- Imágenes anteriores `:20261115` y `:single-restaurant` conservadas para rollback; pins actualizados en `infrastructure/runtime/runtime.env`.
- Prisma: **Database schema is up to date**. Las migraciones `20261114120000_add_wingslab_marketing_consent` y `20261114130000_add_promo_customer_limits` están aplicadas; no hay migraciones pendientes.
- Respaldo principal: `/Users/ayair/Desktop/WingsLab-backups/wingslab_local-20261115-011540.dump`, verificado previamente mediante restauración de prueba. SHA-256: `7d676ba0e999ffdf1bdc96343e2f4417d42a320293395606e0e32d3c9185ee10`.
- Respaldo adicional anterior a estas pruebas: `before-content.dump`, en el directorio de evidencia; su archivo y listado se verificaron, sin declarar una segunda restauración de ensayo.
- Espacio libre al cierre: **24,1 GiB**.
- Cambios de código locales sin commit y sin push. SaDeL y AVOCADOC no se modificaron.

## Evidencia local

Directorio: `/private/var/folders/bp/fw91jby178j6336lpfmmd84m0000gn/T/opencode/wingslab-functional-20261115/`.

- `menu-browser-r3.log`: creación/edición/orden del contenido y presentación móvil. La parte inicial de campañas se sustituyó por la comprobación final descrita arriba.
- `final-browser.log`: duplicación, rechazo del envío sin audiencia, cancelación, activación/desactivación, eliminación, dashboard, clientes y pedidos.
- `account-browser-r3.log`: sesión, consentimiento persistido y audiencia autenticada; formulario de registro en la ejecución anterior `account-browser-r2.log`.
- `final-read-browser.log`: paneles disponibles y vacíos después de limpiar pruebas.
- `menu-evidence/`: capturas, DOM, red, IDs sintéticos y campañas persistidas antes de retirarlas.
- `final-health.json`: servicios y espacio.
- `data-integrity-final.json`: conservación de datos protegidos.

Los perfiles Chrome contienen sesiones ficticias locales; no deben publicarse ni incorporarse al repositorio. La evidencia temporal puede ser eliminada por el sistema; este informe permanece en `docs/`.
