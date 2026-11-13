# Cierre de captura temporal de WhatsApp

Este documento es un plan, no constancia de operaciones en producción. Cada
paso de producción requiere autorización explícita. No guardar credenciales ni
contenido de mensajes en terminales, tickets o logs.

## Estado de ejecución (2026-11-13)

Completado en producción, con autorización explícita:

- Captura desactivada. `WHATSAPP_CAPTURE_ENABLED=false` en el servicio `SaDeL`
  del entorno `production`. El cambio de variable generó el deployment
  `83ba0d02`, que quedó correcto y en servicio. La instancia en ejecución
  resuelve el estado de captura como desactivado por bandera.
- Integridad del webhook verificada tras el cambio: una entrega firmada contra
  la instancia activa devolvió respuesta correcta y el flujo normal de
  autenticación por WhatsApp siguió operativo.
- El deployment anterior dejó de atender solicitudes: no registra peticiones
  HTTP posteriores al cambio y el proceso activo reinició su contador de
  actividad.
- Comprobación de solo lectura de Redis sobre la instancia enlazada al
  servicio: no existen claves de captura, ni con el prefijo de captura, ni en
  ninguna otra clave de la base. La base contiene únicamente las claves
  operativas habituales. El volumen capturado ya había expirado por su TTL
  antes de esta verificación.
- Migraciones de producción: sin pendientes antes y después del cambio.

Pendiente:

- Contención del JWT administrativo comprometido (ver sección siguiente).
- Ejecución opcional del borrado administrativo. El mecanismo previsto sigue
  disponible en la versión desplegada hasta que se publique la retirada del
  código; dado que no quedan datos de captura, su ejecución es un no-op.
- Eliminación de las variables de captura restantes. Son inertes una vez
  publicado el código, pero conviene retirarlas para no dejar una credencial
  huérfana en el panel.

## Orden obligatorio antes de publicar la retirada

1. Contener el JWT administrativo comprometido según el plan de seguridad.
   Usar una sesión administrativa no comprometida para las acciones siguientes.
2. Confirmar proyecto, servicio, entorno, instancia Redis y versión desplegada.
   Verificar migraciones con `prisma migrate status` usando la conexión correcta,
   sin mostrar la URL. El arranque habitual ejecuta `prisma migrate deploy`.
3. Con autorización, poner `WHATSAPP_CAPTURE_ENABLED=false` en Railway. Este
   cambio puede desplegar o reiniciar el servicio: confirmar previamente el
   artefacto, cambios incluidos y ausencia de migraciones pendientes. Conservar
   la clave de cifrado hasta terminar la purga. Confirmar que todas las
   instancias antiguas y operaciones en vuelo terminaron. Verificar salud,
   webhook y flujo normal de autenticación.
4. Con autorización, usar la versión todavía desplegada del endpoint protegido
   `DELETE /admin/whatsapp/captura`. Evitar credenciales en argumentos, URLs,
   historial y registros. No mostrar contenidos. Una respuesta HTTP 200 o
   `removed: 0` no prueba éxito: revisar el indicador `clear_error`.
5. La purga solo elimina entradas indexadas. Pueden quedar claves huérfanas;
   una operación con timeout puede seguir pendiente incluso después de responder.
   Esperar al menos 600 segundos desde que todas las escrituras hayan terminado.
   Con acceso autorizado y de solo lectura a la instancia Redis correcta,
   comprobar únicamente el índice `whatsapp:capture:index` y el número de claves
   `whatsapp:capture:msg:*` mediante SCAN, sin leer valores ni mostrar claves.
   Repetir la comprobación tras confirmar que no quedan productores antiguos.
   Si queda alguna, detenerse: acordar una purga limitada por separado. Nunca
   usar FLUSHDB/FLUSHALL ni tocar claves de autenticación, colas o cachés.
6. Solo tras verificación de purga, autorizar la retirada del código y eliminar
   las variables de captura. No realizar cambios de Meta ni PostgreSQL.

## Contención del JWT administrativo

Un JWT de acceso no se revoca cerrando sesión. El backend verifica la firma y
el estado del usuario; no existe aquí revocación individual de acceso. El TTL
predeterminado es siete días; revocar refresh tokens (30 días) no invalida un
JWT existente. La ruta refresh debe revisarse antes de confiar en una baja de
usuario como contención completa. La caché de estado dura 30 segundos por
proceso y Socket.IO valida el JWT al conectar, por lo que conexiones existentes
pueden requerir desconexión explícita. Revisar todas las rutas de verificación.

Alternativas, solo bajo autorización: caducidad natural si ya expiró; bloqueo
coordinado de cuenta y sus refresh tokens con revisión de conexiones activas;
o rotación global de JWT_SECRET e invalidación de sesiones. La última afecta
usuarios y servicios, OTP por correo y posible descifrado de datos históricos
que dependan de la clave anterior: preparar y probar preservación de claves
históricas y un plan de continuidad antes de actuar. Nunca exponer el token.

## Despliegue y reversión

No desplegar esta retirada antes de completar y verificar la purga: elimina el
endpoint usado para ella. Revisar migraciones de nuevo justo antes de desplegar.
Tras el despliegue, confirmar la versión activa, salud, webhook firmado,
autenticación y notificaciones salientes. Si hay problemas, revertir el cambio
de código de manera controlada manteniendo `WHATSAPP_CAPTURE_ENABLED=false`;
no restaurar datos ni reactivar la captura. El reinicio de rollback también
ejecuta el script de migraciones habitual y exige la misma comprobación previa.
