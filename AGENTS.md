# Instrucciones para agentes de código — WingsLab

## Desarrollo local (flujo por defecto)

```sh
bash scripts/wingslab-dev.sh all start
```

Eso levanta backend (3101), restaurante (3102), comensal (3103) y, si hace falta,
PostgreSQL, Redis y `edge`. Después: editar `src/`, guardar y recargar el navegador.
Para cambios en backend: `bash scripts/wingslab-dev.sh backend compile`.

Detalles: `docs/DESARROLLO_WEB_LOCAL.md`.

## No hacer

- No pasar a `prod`, reconstruir imágenes ni modificar `runtime.env` por cambios de código.
- No intentar eliminar los `[Violation]` de Chrome ni el aviso de React DevTools
  cambiando de modo: son ruido de desarrollo, no errores.
- No hacer commit, push ni limpieza de imágenes salvo solicitud explícita.
- No tocar cambios locales ajenos a la tarea.
- No mostrar credenciales ni el contenido de `config/wingslab.local.json`.
- No crear pedidos reales ni enviar notificaciones de prueba sin autorización.

## Cambios delicados ya resueltos (no revertir)

- Los pedidos activos se muestran siempre, aunque sean de otro día.
- `asumir-reparto` usa `select` de Prisma, no `include`.
- La comanda muestra nombre completo, teléfono y dirección completa con fallbacks.
- El comensal tiene heap de 1024 MB y los servicios de app se reinician solos.
- `[HMR] connected` está filtrado en los `layout.tsx`.

Si algo se cae: volver a correr `bash scripts/wingslab-dev.sh all start`. No reconstruir nada.
