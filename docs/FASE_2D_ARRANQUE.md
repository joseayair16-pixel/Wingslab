# Primer arranque controlado del backend WingsLab

Backend funcionando en `wingslab-2b`, sin descargas, builds, migraciones, seeds ni
resets. Se reutilizó la imagen fijada:
`wingslab-backend@sha256:38909b02db294ab0ff8b0220cb07cd0ab58f7c8964b21bc34ae47f34d1bd4ebe`.

## Revalidación e ingreso

Antes del arranque: UUID PostgreSQL/Redis/configuraciones/labels coincidentes;
base/usuario wingslab_local, servidor 172.30.240.10:5432, 42 tablas public,
4 usuarios y 3 pedidos ficticios; servicios healthy. Aislamiento revalidado.

Solo se añadió `127.0.0.1:3101` a edge. El listener escucha exclusivamente en
172.31.240.10; no en la interfaz interna ni direcciones comodín. Se conservan los
dos puertos de datos loopback; 3102–3104 siguen cerrados. ICC y forwarding
IPv4/IPv6 desactivados, IPv6 apagado. Backend solo en la red interna, IP .21,
UID 1000, readonly, cap_drop ALL, no-new-privileges, restart=no y sin puertos
Docker publicados propios.

Solo config/wingslab.local.json recibió runtime=true/networkVerified=true,
con permisos 0600. Configuraciones host/frontend siguen bloqueadas.

## Pruebas GET reales

| Ruta | Resultado |
| --- | --- |
| `/health` | 200, status ok; db/redis/socketio healthy |
| `/restaurantes?region=WINGS-LAB&openOnly=false` | 200, restaurante ficticio |
| `/restaurantes/:id` del fixture | 200, tres productos ficticios |
| `/store-categories` | 200, lista vacía esperada |
| `/public/zonas-activas` | 200, WINGS-LAB y un restaurante |
| `/metrics` sin sesión | 401, autenticación exigida |

Las lecturas pueden crear claves de caché/rate-limit en Redis propio; después de
servir tráfico DBSIZE no tiene por qué seguir siendo 1. No son cambios de negocio.
environment=production en health representa NODE_ENV optimizado, no identidad
de recursos. La identidad local se verifica por UUID y destinos permitidos.

## Seguridad observada

`python3 scripts/wingslab-verify-network.py --running-backend` pasó en el namespace
real: PG/Redis propios alcanzables; host, peers simulados IPv4/IPv6, relés desde
la red interna y cruces no autorizados bloqueados. DNS interno funciona y nombre
externo .invalid rechazado. Sin ruta por defecto ni forwarding. Host LAN no alcanza
3101, loopback sí. Peers temporales eliminados al terminar.

Captura de sockets TCP establecidos/en conexión: solo PG .10:5432 y Redis
.11:6379. No equivale a captura histórica de todos los paquetes; se complementa
con los controles de red y sondas negativas. Logs y respuestas muestreados no
contienen secretos configurados ni registros ERROR. No se observaron errores críticos.

Socket.IO y subscribers internos se registran; no habilitan proveedores externos.
Firebase, WhatsApp, SMS, correo, Web Push y pagos externos siguen bloqueados; Cloudinary requiere credenciales explícitas
por las capacidades compiladas y el entorno limpio; todos los jobs deshabilitados.
No se probaron POST, login ni operaciones de negocio.

Incidencia: con solo approved-backend, Compose excluía postgres y no validaba el
proyecto. El primer intento no creó el backend. Se habilitaron ambos perfiles
para validación, seleccionando únicamente backend con --no-deps. No se reiniciaron
PG/Redis ni se cambiaron imágenes o controles de seguridad.

## Comandos desde la raíz

Iniciar solo backend, sin pull/build ni dependencias:

```bash
docker --context desktop-linux compose --project-name wingslab-2b \
  --file infrastructure/runtime/compose.yml \
  --env-file infrastructure/runtime/runtime.env \
  --profile approved-2b --profile approved-backend \
  up -d --no-deps --pull never backend
```

Detener solo backend:

```bash
docker --context desktop-linux compose --project-name wingslab-2b \
  --file infrastructure/runtime/compose.yml \
  --env-file infrastructure/runtime/runtime.env \
  --profile approved-2b --profile approved-backend stop backend
```

No usar up sin servicio explícito, --build, down -v ni prune. Stop backend deja
intactos PG/Redis y edge. No se tocaron recursos ajenos ni configuración global.

Continuación recomendada: preparar/autorizar primero cliente y restaurante,
con proveedores simulados. Comprobar autenticación local y Socket.IO antes del
ciclo de pedidos. Frontends, Android, integraciones y jobs siguen sin habilitarse.
