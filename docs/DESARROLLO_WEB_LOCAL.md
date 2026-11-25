# Desarrollo web local con recarga automática

Los cambios de código se ven en la web **sin reconstruir imágenes Docker**. Solo cliente,
restaurante y backend tienen modo desarrollo; repartidor, base de datos y otros
proyectos no se modifican.

## Iniciar

```sh
bash scripts/wingslab-dev.sh all start
# Equivale a: backend (3101), restaurante (3102), comensal (3103).
# El comando también levanta postgres, redis y edge si están detenidos.
```

Cada app se inicia por separado y **cliente y restaurante pueden estar activos a la vez**.
Ambos tienen el heap de Node limitado a 1024 MB para coexistir con backend, PostgreSQL,
Redis y `edge` dentro de la VM Docker; los servicios de app se reinician automáticamente
si el proceso muere. El comando `start` también levanta `postgres`, `redis` y `edge` si
están detenidos: `edge` es el único que publica los puertos 3101-3103, así que sin él
las apps responden «Ready» pero el navegador no puede conectarse.

Para ver logs: `bash scripts/wingslab-dev.sh customer logs`.

Si el equipo tiene poca memoria libre, detén el que no estés usando:
`bash scripts/wingslab-dev.sh restaurant prod`.

## Cómo se propagan los cambios

- **Cliente y restaurante:** guarda el archivo en `src/` y recarga el navegador. Next
  recompila solo lo necesario (menos de un segundo tras el primer arranque).
- **Backend:** tras cambiar `packages/backend/src`, ejecuta
  `bash scripts/wingslab-dev.sh backend compile`. Compila en el host en segundos y
  el proceso se reinicia una sola vez, cuando la compilación terminó por completo
  (señal `dist/.reload`), nunca a mitad de la escritura de archivos.

El código se monta en solo lectura; los archivos generados por Next viven en un
`tmpfs` del contenedor. La configuración local con credenciales sigue siendo la
misma y no se versiona.

## Volver a la imagen compilada

```sh
bash scripts/wingslab-dev.sh customer prod
bash scripts/wingslab-dev.sh restaurant prod
bash scripts/wingslab-dev.sh backend prod
```

Esto restaura la versión estable fijada en `infrastructure/runtime/runtime.env`.

**No usar `prod` para desarrollar.** El modo `prod` existe solo para ejecutar una
versión estable o hacer una demo; no tiene recarga automática y cada cambio exige
reconstruir la imagen. Los mensajes `[Violation]` de Chrome y el aviso de React
DevTools son ruido exclusivo de desarrollo: son inofensivos y no deben motivar un
cambio de modo. `[HMR] connected` ya está filtrado en el código.

También son ruido esperado de desarrollo:

- `beforeinstallpromptevent.preventDefault() called`: Chrome avisa que no mostrará
  su mini-infobar porque la PWA captura el evento para enseñar su propio botón
  «Instalar». Es intencional; el `prompt()` se lanza al pulsar el botón.
- `WebSocket connection ... failed` y `[Socket] connect_error: websocket error`
  justo después de recargar o de `backend compile`: el backend tarda ~4 s en
  volver y las conexiones abiertas se cortan. El reinicio único por compilación
  evita los 5xx repetidos. Un rechazo `UNAUTHORIZED` sí significa token viejo y
  la app lo renueva sola.

## Reglas para agentes de código

1. El flujo normal es **desarrollo**: `bash scripts/wingslab-dev.sh all start`,
   editar `src/`, guardar y recargar. Para backend, `backend compile`.
2. **No** pasar a `prod`, reconstruir imágenes ni tocar `runtime.env` para cambios
   de código. Eso es despliegue, no desarrollo.
3. **No** intentar «arreglar» los `[Violation]` de Chrome ni el aviso de React
   DevTools cambiando de modo. Son avisos de desarrollo, no errores.
4. **No** hacer commit, push ni limpieza de imágenes salvo que el usuario lo pida
   explícitamente.
5. No tocar archivos ajenos a la tarea; el repositorio puede tener cambios locales
   del usuario sin commitear.
6. `config/wingslab.local.json` está ignorado y con permisos `600`: nunca mostrar
   su contenido ni reutilizar credenciales de otro proyecto.
7. No crear pedidos reales ni enviar notificaciones de prueba sin autorización.

## Notas

- Los tres modos desarrollo usan la misma imagen base ya aprobada, sin instalar
  paquetes ni acceder a Google durante el arranque.
- `@sadel/shared` se resuelve desde `packages/shared/src`. Por eso los módulos
  compartidos que antes eran `.js` CommonJS ahora son `.ts`; la validación de
  orígenes para Node conserva un gemelo `wingslab-policy.cjs`.
- La compilación de imágenes sigue disponible para versiones estables; este modo
  es solo para iterar rápidamente.
