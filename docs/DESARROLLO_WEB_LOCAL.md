# Desarrollo web local con recarga automática

Los cambios de código se ven en la web **sin reconstruir imágenes Docker**. Solo cliente,
restaurante y backend tienen modo desarrollo; repartidor, base de datos y otros
proyectos no se modifican.

## Iniciar

```sh
bash scripts/wingslab-dev.sh customer start     # http://127.0.0.1:3103
bash scripts/wingslab-dev.sh restaurant start   # http://127.0.0.1:3102
bash scripts/wingslab-dev.sh backend start      # API en 127.0.0.1:3101
```

Cada app se inicia por separado y **cliente y restaurante pueden estar activos a la vez**
(con el heap limitado a 640 MB). Para ver logs: `bash scripts/wingslab-dev.sh customer logs`.

Si el equipo tiene poca memoria libre, detén el que no estés usando:
`bash scripts/wingslab-dev.sh restaurant prod`.

## Cómo se propagan los cambios

- **Cliente y restaurante:** guarda el archivo en `src/` y recarga el navegador. Next
  recompila solo lo necesario (menos de un segundo tras el primer arranque).
- **Backend:** tras cambiar `packages/backend/src`, ejecuta
  `bash scripts/wingslab-dev.sh backend compile`. Compila en el host en segundos y
  `node --watch` reinicia el proceso automáticamente.

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

## Notas

- Los tres modos desarrollo usan la misma imagen base ya aprobada, sin instalar
  paquetes ni acceder a Google durante el arranque.
- `@sadel/shared` se resuelve desde `packages/shared/src`. Por eso los módulos
  compartidos que antes eran `.js` CommonJS ahora son `.ts`; la validación de
  orígenes para Node conserva un gemelo `wingslab-policy.cjs`.
- La compilación de imágenes sigue disponible para versiones estables; este modo
  es solo para iterar rápidamente.
