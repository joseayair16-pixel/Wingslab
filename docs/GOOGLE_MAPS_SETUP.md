# Google Maps Platform en WingsLab

## Opt-in local por frontend

La clave de Maps es una clave pública de navegador (no una credencial de servidor), pero debe permanecer fuera de Git y estar restringida en Google Cloud. Configúrala únicamente en los archivos ignorados por Git, según los frontends que se quieran probar:

- `config/wingslab.customer.local.json` — direcciones de clientes y checkout.
- `config/wingslab.restaurant.local.json` — dirección y ubicación del restaurante.
- `config/wingslab.frontend.local.json` — app de repartidor.

En la raíz de cada archivo:

```json
{
  "googleMaps": {
    "enabled": true,
    "apiKey": "CLAVE_PUBLICA_DE_MAPS"
  }
}
```

Los ejemplos versionados (`config/wingslab.frontend.example.json` y `config/wingslab.local.example.json`) mantienen `enabled: false` y una clave vacía. El lanzador inyecta solo esta configuración explícita a los procesos de frontend; nunca al backend. Una ruta runtime `no-store` entrega la clave al navegador solo cuando Maps está habilitado. No se habilita el interruptor general de servicios externos, que continúa apagado para no activar Firebase/Push u otros proveedores.

## APIs y restricciones

Para búsqueda de domicilios y mapas se requieren **Maps JavaScript API** y **Places API (New)**. La búsqueda y la selección usan Places API (New), no Places legacy. El geocodificado inverso que rellena el domicilio al mover el marcador o usar GPS requiere además **Geocoding API**; esta integración no llama Routes API.

Restringe la clave por API y por referente HTTP a los orígenes locales durante las pruebas (`http://localhost:3102/*`, `http://localhost:3103/*`, `http://localhost:3104/*`; agrega `127.0.0.1` si también se usa ese hostname). Antes de producción, cambia las restricciones a los dominios HTTPS definitivos y habilita solo las APIs realmente usadas.

La CSP de WingsLab permite los hosts de scripts, tiles y solicitudes de Google Maps/Places. La carga de Maps es bajo demanda, no en cada visita. Firebase OTP conserva su configuración y dominios existentes.

## Llamadas y costos

La búsqueda Places espera al menos cuatro caracteres, aplica debounce de 500 ms, limita cada fuente a una solicitud cada 1.2 s y limita sugerencias a cinco. No persistimos ni cacheamos predicciones de Places. Se conserva un token durante el tipeo y el resultado mantiene su `PlacePrediction`; al elegirlo, `toPlace().fetchFields()` termina la sesión asociando el token. Solo se piden campos de dirección y geometría que usa el formulario. Las cuotas por API y alertas de presupuesto deben configurarse también en Google Cloud: los límites del cliente reducen tráfico accidental, pero no son barrera de seguridad ni tope de facturación.

## GPS y rutas existentes

El seguimiento de ubicación usa la geolocalización nativa del navegador/dispositivo con permiso del usuario; **no necesita una API de Google**. Dibujar mapas requiere Maps JavaScript; buscar domicilios requiere Places; convertir coordenadas a texto requiere Geocoding API. El código de navegación de repartidor usa `google.maps.DirectionsService`; no llama directamente a Routes API. Si ese recorrido muestra `REQUEST_DENIED`, comprobar si hace falta Directions API (Legacy) o migrar explícitamente el cálculo a Routes API. No se habilita ni se llama Routes API desde esta integración de búsqueda.

## Verificación local

Después de autorizar y reconstruir la imagen del frontend, `/wingslab-google-maps-config` debe responder `503` con Maps deshabilitado, y `{ enabled: true, apiKey: ... }` con la configuración local activada. Esa respuesta contiene una clave pública de navegador; no compartirla en capturas, logs ni tickets. La prueba final de Places, selección/arrastre de marcador, guardado y restricciones HTTP referrer requiere abrir el navegador y revisar la consola y el panel Network.
