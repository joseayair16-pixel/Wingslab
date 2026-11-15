# Fase 3 — preparación cliente y restaurante

## Punto de autorización: aún no arrancados

No se crearon ni iniciaron contenedores, no se publicaron puertos nuevos ni se
descargaron paquetes. Backend, base, fixtures e imagen backend no se modificaron.
No hubo migraciones/seeds ni peticiones de creación de pedidos/autenticación.

## Configuración inspeccionada y corrección mínima

Cliente: Next 16.3.4 / React 18, puerto planeado 3103; restaurante: misma versión
Next, puerto 3102. Scripts de inicio pasan por el launcher explícito WingsLab.
Ambos consumen API y Socket.IO mediante helpers compartidos de origen permitido.

Se corrigió una incompatibilidad real antes de construir:

- Navegador: API/Socket.IO `http://127.0.0.1:3101`.
- Next SSR/proxy: API interna `http://172.30.240.21:3101` mediante variable privada
  `WINGSLAB_INTERNAL_API_URL`, añadida a la allowlist del launcher.
- El rewrite `/api/:path*` utiliza el destino interno, no loopback del contenedor
  frontend. El helper de API utiliza el destino interno solo en servidor.
- La variable privada no se exporta mediante `nextConfig.env`; no contiene secretos.
- Se rechazan otros orígenes internos. No se modificó la imagen backend existente.

Pruebas estáticas: separación browser/SSR y rewrite pasan para ambos roles;
TypeScript noEmit: 0 diagnósticos cliente y restaurante. No equivalen a ejecución
Next ni a pruebas de navegador.

Cliente ya tiene loader, error boundary y reintento; detalle de restaurante usa
layout SSR y página cliente. Su navegación/productos/carga/error aún requieren
verificación real. SSR no tenía acceso correcto hasta la corrección anterior.

Restaurante usa POST `/auth/restaurant-login` con teléfono y contraseña, comprueba
rol RESTAURANT y configura Socket.IO con token/join-room. Backend tiene esa ruta y
validación real del rol. Login crea refresh token local: no es una operación SQL
puramente de lectura, pero no invoca proveedores OTP externos para ese acceso.
Se utilizará solo la cuenta sintética del seed, nunca credenciales SaDeL.

## Recursos mínimos

Recorrido dirigido de dependencias de cliente/restaurante/shared y herramientas
necesarias: 184 tarballs disponibles y verificados por SRI, incluidas dependencias
Sharp aprovisionadas en Fase 2C. Node oficial Linux/arm64 ya está materializado
localmente. No reinstalar node_modules del host ni instalar todo el monorepositorio.

Única ausencia para construir con webpack:

- `@next/swc-linux-arm64-musl@16.3.4`.
- Origen: `https://registry.npmjs.org/@next/swc-linux-arm64-musl/-/swc-linux-arm64-musl-16.3.4.tgz`.
- Plataforma: Linux/arm64, musl (Alpine).
- SRI público que se comprobará contra el lockfile:
  `sha512-mx03GNs1ocQA5JQ4FxDMmIsNkdrZh8cuezKCrId28e5/gIPU/l7Kcy2+vmCCzdjnnmXJy+iOAu+7K0QppO6Urg==`.
- Tamaño publicado descomprimido: 87.531.791 bytes (83,48 MiB).
  HEAD no indica tamaño comprimido: reservar un máximo de 84 MiB para el tarball;
  no presentar esa reserva como transferencia medida. Si supera el límite, parar.
- No pedir SWC glibc, esbuild, unrs o WASM para este build webpack.

## Secuencia propuesta, pendiente de autorización

1. Descargar solo ese tarball y verificar SRI; reutilizar Node/caché.
2. Preparar imagen exclusiva de cliente con contexto allowlisted y RUN sin red.
   No incluir JSON local, env, secretos, datos, backups ni artefactos anteriores.
   Si el build demanda otro recurso o proveedor, detener y solicitar autorización.
3. Separar perfiles/imágenes/configuraciones por rol: no reutilizar autorización
   backend ni activar a la vez cliente y restaurante.
4. Autorizar y crear primero cliente en red interna (.22), readonly, UID 1000,
   sin capacidades, forwarding ni IPv6. Publicar exclusivamente 127.0.0.1:3103
   mediante edge, conservando escucha en interfaz de ingreso e ICC desactivado.
5. Comprobar HTTP/SSR/proxy, assets locales, CSP, navegación, catálogo, detalle,
   carga/error y navegador si se dispone de una herramienta ya instalada.
   No dar por probado UI por obtener solo HTTP200. Excluir conexiones externas
   también del navegador: CSP, proveedores bloqueados y revisión de solicitudes.
6. Informar del cliente; solicitar autorización separada para restaurante (.23,
   loopback 3102), login sintético, acceso por roles, catálogo, pedidos y Socket.IO.
7. Solo con ambas interfaces verificadas, ejecutar pruebas reales de creación y
   transiciones sobre datos sintéticos, registrando errores/reglas sin fingir éxito.

No iniciar driver, admin, Android, jobs ni integraciones. Google Maps/servicios
externos permanecen bloqueados. No convertir faltantes de mapas/geolocalización
en resultados exitosos de checkout: pueden requerir adaptación local explícita.

## Reutilización funcional y evidencia pendiente

Reutilizables inicialmente: componentes existentes de catálogo/productos/carrito,
login restaurante, consultas de pedidos, controles por rol y eventos Socket.IO.
Esto es inspección de código, no garantía de que el flujo completo funcione.

Adaptación necesaria confirmada: URL server-side/proxy por topología separada.
Pendiente de comprobar: región/geolocalización inicial del cliente, checkout sin
mapas externos, OTP cliente simulado, reglas de transiciones, room de restaurante
y actualización UI por eventos. No cambiar identidad visual ni estilos todavía.

URLs planeadas, **aún no activas**: cliente `http://127.0.0.1:3103`, restaurante
`http://127.0.0.1:3102`. Backend existente: `http://127.0.0.1:3101`.

## Resultado ejecutado — cliente autorizado y funcionando

El punto de autorización anterior es histórico. Solo el cliente fue autorizado,
construido e iniciado; restaurante, driver y Android siguen sin iniciarse.

### Aprovisionamiento y build

- Única descarga: SWC Linux/arm64-musl 16.3.4, **31.373.703 bytes (29,92 MiB)**,
  SRI verificado contra package-lock.json y bajo el límite de 84 MiB.
- Contexto dirigido solo cliente/shared: 150 tarballs verificados, 149 reutilizados
  y el SWC descargado. Incluye Sharp previamente autorizado en Fase 2C.
- Base Node oficial ya local; ninguna imagen base, paquete o motor adicional.
- `scripts/wingslab-stage-customer.py` genera contexto nuevo sin instalar en host,
  sin ejecutar lifecycle scripts y aborta si falta algún tarball verificado.
  No copia JSON local, credenciales backend, env, backups ni frontends ajenos.
- Build de Next 16.3.4 con webpack, TypeScript y generación de páginas pasan con
  todos los RUN `--network=none`, sin acceso a backend durante la compilación.
- Se corrigió el guard de build: BuildKit no siempre tiene /.dockerenv y el kernel
  lista interfaces túnel sin configurar. Se comprueba Linux, solo direcciones
  loopback y tabla de rutas IPv4 vacía, además del flag de build autorizado.
- Se corrigió el cwd del build a packages/web-customer: Tailwind no encontraba
  configuración desde la raíz. Build final sin esa advertencia y estilos
  existentes conservados; no se cambió el diseño.

Imagen cliente final:
`wingslab-customer@sha256:e0088b43654ad3088841b43ba9d14405c93f7f4884c4fa3f0775e2869aa78064`.
Fijada en WINGSLAB_CUSTOMER_IMAGE del env local ignorado por Git.

### Arranque y red

- Servicio customer, perfil approved-customer independiente, IP 172.30.240.22
  únicamente en wingslab_2b_internal, UID 1000, readonly, cap_drop ALL,
  no-new-privileges, forwarding 0 e IPv6 desactivado; sin puertos propios publicados.
- Configuración específica `config/wingslab.customer.local.json`, permisos 0600,
  role=customer. No contiene backend/credenciales. La política rechaza usarla
  para otro rol. Se monta readonly como configuración del launcher.
- Edge escucha 3103 solo en su IP de ingreso 172.31.240.10 y publica únicamente
  127.0.0.1:3103. No se activaron 3102 ni 3104. El acceso LAN a 3103 falla.
- Backend, PostgreSQL y Redis conservan los mismos IDs y StartedAt: no se
  reiniciaron. Solo se recreó edge para añadir el puerto autorizado y se creó customer.
- `scripts/wingslab-verify-network.py --running-customer` pasa: sin ruta externa,
  host/peers propios IPv4/IPv6 y cruces no autorizados bloqueados. El namespace
  comparte la red WingsLab de datos como se preparó en Fase 2B: no es una ACL
  entre servicios WingsLab. El cliente no recibe credenciales de PG/Redis y sus
  llamadas observadas solo utilizan API WingsLab. No afirmar segmentación SQL
  entre miembros de esa misma red.
- Snapshot TCP cliente: sin destinos inesperados. Backend health sigue 200 y
  PG/Redis/Socket.IO healthy. Logs revisados sin ERROR crítico ni secretos locales.

### Evidencia HTTP y navegador real

URL activa: `http://127.0.0.1:3103`.
Acceso directo al catálogo, sin necesidad de geolocalización inicial:
`http://127.0.0.1:3103/restaurantes/cmwgvmcia0006s4mlqs7brrh7`.

- Raíz, detalle y `/api/restaurantes?region=WINGS-LAB&openOnly=false`: HTTP200.
- SSR dinámico del restaurante: título con WingsLab y JSON-LD del restaurante
  ficticio, obtenido por el destino interno .21:3101, no localhost del cliente.
- Peticiones de la UI observadas: `/api/settings`, `/api/restaurantes/...`,
  categorías y otras rutas relativas en 3103, reenviadas exclusivamente a WingsLab.
- Chrome local existente, headless con perfil nuevo aislado y CDP por pipe; no se
  descargó Playwright, navegador ni herramientas adicionales. No se utilizó ningún
  perfil de usuario existente. Resolución externa deshabilitada y peticiones de
  página interceptadas antes de navegar, permitiendo solo 127.0.0.1:3101/3103.
- En el recorrido comprobado no hubo intentos externos interceptados ni excepciones
  JS no manejadas. Todos los requests HTTP observados tienen origen 3103; no hubo
  solicitudes a producción SaDeL. CSP adicional bloquea recursos externos en la UI.
- Catálogo en portada: con coordenadas ficticias explícitas en sessionStorage
  del navegador de prueba, muestra el restaurante. Se hizo clic real en su tarjeta
  y Next navegó al detalle; no se simuló una respuesta exitosa del servidor.
- Categoría Alitas ficticias y productos x6, x12 y Papas, descripción y precios:
  visibles. Añadir al carrito cambia cantidad y muestra $120, solo estado local.
- Respuesta retrasada mediante CDP: aparece Cargando. Petición al menú bloqueada
  únicamente en navegador: error visible y botón Reintentar. Al restaurar red y
  pulsar ese botón, vuelve el catálogo. Backend no se detuvo ni cambió para la prueba.
- Capturas/DOM y red de prueba guardados bajo el directorio temporal propio
  `wingslab-3-client-lgrtv2ao/browser-check-final`; no se incorporan al repositorio.

Verificador reproducible (usar destino de evidencia nuevo, nunca perfil personal):

```bash
node scripts/wingslab-customer-browser-check.cjs NUEVO_DIRECTORIO_DE_EVIDENCIA \
  cmwgvmcia0006s4mlqs7brrh7
python3 scripts/wingslab-verify-network.py --running-customer
```

### Límites funcionales reales (sin maquillar resultados)

- Perfil nuevo en `/` muestra ¿Dónde estás? El buscador de direcciones depende
  del proveedor de mapas deshabilitado. No se habilitó Maps ni se falseó GPS:
  las pruebas de portada usan una ubicación sintética de sesión. El enlace directo
  de restaurante funciona sin mapas. Falta decidir un selector local de zona de
  pruebas antes de considerar resuelta la entrada general sin geolocalización.
- En el tema actual de restaurante, la tarjeta muestra detalle básico inline
  (nombre, descripción y precio), pero no tiene control para abrir el modal de
  preview. No se reporta modal independiente como probado ni se cambió el tema.
- El error de red muestra tanto «No se pudo cargar el menú» como «No encontramos
  este restaurante», mensaje ambiguo existente. Reintentar sí funciona.
- Autenticación cliente, checkout, creación de pedidos, Socket.IO autenticado y
  actualización restaurante todavía NO verificados. No se creó ningún pedido.
- Marca SaDeL en assets/textos sigue presente por instrucción de no rediseñar;
  no implica conexión a sus servicios. No hubo cambios de DB, seeds o esquema.
- Backend y sus guardas de proveedores/jobs no se cambiaron. No se habilitaron
  Firebase, WhatsApp, SMS, correo, R2, Web Push, pagos ni trabajos automáticos.

### Comandos cliente desde la raíz

```bash
docker --context desktop-linux compose -p wingslab-2b \
  -f infrastructure/runtime/compose.yml \
  --env-file infrastructure/runtime/runtime.env \
  --profile approved-2b --profile approved-backend --profile approved-customer \
  up -d --no-deps --pull never customer

docker --context desktop-linux compose -p wingslab-2b \
  -f infrastructure/runtime/compose.yml \
  --env-file infrastructure/runtime/runtime.env \
  --profile approved-2b --profile approved-backend --profile approved-customer \
  stop customer
```

### Próximo punto de autorización

Restaurante sigue apagado y 3102 cerrado. Se requiere autorización separada para
su build offline, contenedor independiente, configuración de rol y publicación
loopback 3102. SWC/Node/Sharp están ahora disponibles; no se prevén más descargas,
pero si el árbol exacto exige otra, se detendrá el aprovisionamiento y se solicitará.
Después: login con el teléfono/contraseña sintéticos del seed, rol, pedidos y
catálogo readonly, conexión Socket.IO real; recién entonces preparar el flujo
de creación/aceptación/preparación con autorización para operaciones de negocio.
