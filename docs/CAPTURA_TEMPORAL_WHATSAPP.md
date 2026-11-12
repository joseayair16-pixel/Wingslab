# Captura temporal de mensajes entrantes de WhatsApp

> **Función de emergencia, apagada por defecto y reversible.**
> No es una bandeja de entrada, no es un producto y no debe quedarse activa.
> Sirve para recuperar, durante unos minutos, un código de verificación que una
> persona envió por WhatsApp al número de negocio (por ejemplo el que envía BAIT).
>
> **No requiere migraciones, no cambia el esquema de PostgreSQL y no cambia la
> URL del webhook configurada en Meta.**

---

## 1. Qué hace

| Aspecto | Comportamiento |
|---|---|
| Estado inicial | **Apagada.** Requiere `WHATSAPP_CAPTURE_ENABLED=true` y otras dos variables. |
| Qué captura | Solo mensajes entrantes de **tipo texto** (`type: "text"`). |
| A quién captura | Solo al `phone_number_id` indicado en `WHATSAPP_CAPTURE_PHONE_NUMBER_ID`. |
| Dónde vive | En **Redis**, cifrado con AES-256-GCM, con TTL y cupo acotados. |
| Vigencia máxima | **600 s (10 minutos)** por mensaje. Tope duro, no configurable por encima. |
| Cupo máximo | 10 mensajes por defecto (tope duro: 50). Los más antiguos se descartan. |
| Consulta | `GET /admin/whatsapp/captura` — exige sesión **ADMIN**. |
| Purga | `DELETE /admin/whatsapp/captura` — borra todo al instante. |
| PostgreSQL | **No se usa.** El esquema de la base de datos no cambia. |
| Webhook de Meta | **No cambia.** Sigue la misma URL y la misma validación HMAC. |
| Verificación SADEL | **No cambia.** El flujo de validación de teléfono sigue intacto. |

### Lo que la captura NO hace

- No responde al remitente.
- No guarda adjuntos (imágenes, audio, documentos): solo texto.
- No guarda el payload completo de Meta: únicamente `from`, `body`, `timestamp`,
  `receivedAt` y un identificador corto derivado del id de mensaje de Meta.
- No escribe contenido, códigos, números completos, tokens ni secretos en los logs.
- No expone ningún endpoint público de lectura.

---

## 2. Variables de entorno

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `WHATSAPP_CAPTURE_ENABLED` | Sí | `false` | Debe ser exactamente `true` para activar. |
| `WHATSAPP_CAPTURE_PHONE_NUMBER_ID` | Sí | — | `phone_number_id` de Meta del número autorizado. Es el mismo valor que `WHATSAPP_PHONE_NUMBER_ID` si ese número es el de negocio. |
| `WHATSAPP_CAPTURE_ENCRYPTION_KEY` | Sí | — | Clave **dedicada** de cifrado (mínimo 16 caracteres). Debe ser distinta de `DATABASE_ENCRYPTION_KEY` y de `JWT_SECRET`; si coincide con alguna, la captura se rechaza. |
| `WHATSAPP_CAPTURE_TTL_SECONDS` | No | `600` | Vigencia de cada mensaje. Se acota a 600 s. |
| `WHATSAPP_CAPTURE_MAX_MESSAGES` | No | `10` | Cupo de mensajes retenidos. Se acota a 50. |

Si falta cualquiera de las tres obligatorias, la función queda **desactivada**
(fail closed) y el webhook sigue funcionando exactamente igual.

---

## 3. Activar en Railway (y volver a apagar)

### 3.1 Generar la clave dedicada

```bash
openssl rand -hex 32
```

Anota el resultado en un gestor de contraseñas. **No la pegues en el chat ni en
un ticket.** No la reutilices para nada más.

### 3.2 Configurar las variables

En el servicio de Railway del backend:

```
Service → tu servicio backend → Variables → Raw Variables
```

Añade:

```
WHATSAPP_CAPTURE_ENABLED=true
WHATSAPP_CAPTURE_PHONE_NUMBER_ID=<PHONE_NUMBER_ID_DE_META>
WHATSAPP_CAPTURE_ENCRYPTION_KEY=<clave_aleatoria_de_32_bytes>
WHATSAPP_CAPTURE_TTL_SECONDS=600
WHATSAPP_CAPTURE_MAX_MESSAGES=10
```

> `PHONE_NUMBER_ID_DE_META` se obtiene en **Meta Business Suite → WhatsApp Manager →
> Números de teléfono → tu número → Configuración de API → ID del número de teléfono**
> (o en App Dashboard → WhatsApp → API Setup). Es un identificador numérico de la
> WABA, **no** el número de teléfono.

### 3.3 Desplegar

Railway reinicia el servicio al guardar variables. Confirma que arrancó bien:

```bash
curl -s https://sadel-production.up.railway.app/health
```

### 3.4 Pedir el código y capturarlo

1. Pide a la persona que te envíe el código por WhatsApp al número de negocio.
2. Inmediatamente después, consulta la captura (ver sección 4).

> La ventana es de **10 minutos como máximo**. Piensa el tiempo de consulta
> antes de pedir el código: activa → pide → consulta → desactiva.

---

## 4. Consultar los mensajes capturados

### 4.1 Obtener un token de administrador

```bash
curl -s -X POST https://sadel-production.up.railway.app/auth/admin-login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"<TU_TELEFONO_ADMIN>","password":"<TU_PASSWORD_ADMIN>"}'
```

Devuelve `data.token`. Guárdalo en una variable de shell:

```bash
export TOKEN_ADMIN='<PEGAR_AQUI_EL_TOKEN>'
```

### 4.2 Listar la captura

```bash
curl -s https://sadel-production.up.railway.app/admin/whatsapp/captura \
  -H "Authorization: Bearer $TOKEN_ADMIN"
```

Respuesta:

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "3f2a1c9d8e7b6a5f",
        "from": "5215512345678",
        "body": "AQUI_ESTA_EL_CODIGO",
        "timestamp": "1700000000",
        "receivedAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "total": 1,
    "ttlSeconds": 600,
    "maxMessages": 10
  }
}
```

Los mensajes llegan **del más reciente al más antiguo**.

Alternativa desde el panel web: el panel de admin llama a la API con el prefijo
`/api`, así que la misma ruta funciona en
`https://<DOMINIO_ADMIN>/api/admin/whatsapp/captura` con la sesión ya abierta.

### 4.3 Respuestas habituales

| Código HTTP | Significado |
|---|---|
| `200` | Consulta realizada. `data.total` puede ser `0` si aún no ha llegado ningún mensaje o si ya expiró. |
| `401` | Falta el token o expiró. |
| `403` | La sesión no es de rol ADMIN. |
| `404` `CAPTURE_DISABLED` | La captura está apagada o mal configurada. |

---

## 5. Desactivar de inmediato

Apagar es **cambiar `WHATSAPP_CAPTURE_ENABLED` a `false`** y reiniciar el
servicio (Railway lo hace al guardar). A partir de ese momento el webhook vuelve
a descartar todo lo que no sea un código `SADEL`.

Para **no dejar nada almacenado** además:

```bash
curl -s -X DELETE https://sadel-production.up.railway.app/admin/whatsapp/captura \
  -H "Authorization: Bearer $TOKEN_ADMIN"
```

```json
{ "success": true, "data": { "removed": 1 } }
```

Y, por limpieza, elimina también las variables del panel de Railway
(`WHATSAPP_CAPTURE_ENABLED`, `WHATSAPP_CAPTURE_PHONE_NUMBER_ID`,
`WHATSAPP_CAPTURE_ENCRYPTION_KEY`, `WHATSAPP_CAPTURE_TTL_SECONDS`,
`WHATSAPP_CAPTURE_MAX_MESSAGES`). Si se borra la clave de cifrado, los mensajes
que quedaran en Redis son indescifrables y se limpian solos por TTL.

---

## 6. Garantías de seguridad implementadas

- **Fail closed:** sin las tres variables obligatorias no se captura nada.
- **Aislamiento por número:** solo se captura para el `phone_number_id` autorizado.
  Los mensajes destinados a otros números de la misma WABA se descartan.
- **Cifrado dedicado:** AES-256-GCM con una clave independiente de `JWT_SECRET` y
  de `DATABASE_ENCRYPTION_KEY`. Si se configura una clave reutilizada, la captura
  se rechaza.
- **Depósito mínimo:** no se guarda el payload de Meta, solo los campos listados
  en la sección 1.
- **Logs limpios:** el backend solo registra conteos (`{"captured":1}`). Nunca el
  texto, ni el código, ni el número completo, ni la clave.
- **Acceso restringido:** la consulta exige `authenticate` + `authorize([ADMIN])`
  (el mismo middleware del resto de rutas administrativas) y tiene rate limit
  propio (30/min).
- **Expiración:** TTL máximo de 10 minutos por mensaje; el índice se refresca con
  el mismo TTL y las entradas caducadas se limpian al leer.
- **Idempotencia:** los reintentos de Meta no duplican mensajes (se deduplica por
  el id de mensaje de Meta).
- **Sin impacto en el flujo actual:** la captura no puede romper la verificación
  SADEL ni la respuesta 200 a Meta; cualquier fallo se aísla y se registra sin
  contenido.

---

## 7. Comportamiento con Meta

- La **URL del webhook no cambia**. No hay que tocar nada en Meta.
- La **firma HMAC** (`X-Hub-Signature-256`) se sigue validando igual. Un evento
  con firma inválida se rechaza con `401` y **no** se captura.
- Meta **no reenvía** eventos ya entregados: por eso la captura solo sirve para
  mensajes que lleguen **después** de activarla. Los mensajes anteriores a la
  activación no son recuperables desde SaDeL.
- Reenviar un mensaje desde el propio WhatsApp del remitente es la forma más
  simple de probar la captura sin pedir nada a terceros.

---

## 8. Reversión completa (eliminar la función)

Si tras el incidente quieres quitar el código por completo:

```bash
# 1. Apagar y limpiar variables en Railway (sección 5)
# 2. Revertir el commit en GitHub / Railway
git revert <commit-de-la-captura>
```

El revert deja el webhook exactamente como estaba: sin captura, sin endpoint
administrativo y sin variables nuevas. No hay migraciones que revertir porque
no se tocó el esquema de PostgreSQL.

Archivos que introduce la función:

```
packages/backend/src/services/whatsapp-capture.service.ts
packages/backend/src/routes/admin-whatsapp-capture.routes.ts
packages/backend/src/routes/whatsapp-capture.integration.test.ts
```

Archivos que modifica:

```
packages/backend/src/routes/whatsapp-webhook.routes.ts   (integración, no rompe el flujo)
packages/backend/src/routes/index.ts                     (registro de la ruta admin)
packages/backend/src/config/env.ts                       (variable opcional)
packages/backend/src/test-setup.ts                       (secretos de prueba del webhook)
.env.example                                             (documentación de variables)
```

---

## 9. Diagnóstico rápido

| Síntoma | Causa probable | Qué revisar |
|---|---|---|
| `404 CAPTURE_DISABLED` | Flag apagado o variables faltantes | `WHATSAPP_CAPTURE_ENABLED` y las otras dos obligatorias en Railway |
| `200` pero `total: 0` | El mensaje llegó antes de activar, expiró, o no es de tipo texto | Timeline de activación vs. envío; tipo del mensaje |
| `200` pero `total: 0` y hubo log `[WhatsApp Webhook] Captura temporal {"captured":1}` | Se capturó y expiró antes de consultar | TTL vs. tiempo transcurrido |
| No aparece el log `[WhatsApp Webhook] Captura temporal` | El mensaje no era de texto, el `phone_number_id` no coincide o la captura está apagada | `WHATSAPP_CAPTURE_PHONE_NUMBER_ID` vs. el `phone_number_id` del evento |
| El webhook devuelve `401` | Firma inválida | `WHATSAPP_WEBHOOK_APP_SECRET` sin cambios respecto a Meta |
