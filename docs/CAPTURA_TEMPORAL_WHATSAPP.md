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
| Observabilidad | Cada mensaje entrante genera una línea estructurada con su resultado y motivo (ver §6). |

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

## 6. Observabilidad (Fase 1 — diagnóstico)

Desde la auditoría del 12 de noviembre de 2026, el webhook emite **una línea
estructurada por mensaje entrante** que permite distinguir un mensaje
**capturado** de uno **descartado**, con el motivo exacto.

### 6.1 Línea por mensaje

```json
{
  "level": "INFO",
  "message": "[WhatsApp Capture] Mensaje entrante",
  "type": "button",
  "result": "ignored",
  "reason": "type_not_supported",
  "phoneNumberIdMatch": true,
  "redis": "not_attempted",
  "messageIdHash": "68b741ef1d6c76f5",
  "senderHash": "64b376cbebd2"
}
```

| Campo | Significado |
|---|---|
| `type` | Tipo de mensaje declarado por Meta (`text`, `button`, `interactive`, `image`, `unsupported`, …). `n/a` en líneas a nivel de evento. |
| `result` | `captured` \| `ignored` \| `error`. |
| `reason` | Motivo exacto (vocabulario cerrado, ver 7.3). |
| `phoneNumberIdMatch` | `true` si el `phone_number_id` del evento coincide con el autorizado; `false` si no coincide o no se recibió; `null` si se desconoce. |
| `redis` | `ok` (guardado) \| `error` (fallo de Redis) \| `timeout` (se agotó el presupuesto de 1,5 s) \| `not_attempted` (no se intentó escribir). |
| `messageIdHash` | Hash SHA-256 truncado (16 hex) del id de mensaje de Meta. **Coincide con el campo `id` del registro capturado**, así que permite correlacionar log ↔ consulta administrativa. |
| `senderHash` | Pseudónimo HMAC-SHA256 (12 hex) del remitente (usa `from_user_id`/BSUID si Meta lo provee). Permite saber si dos mensajes vinieron del mismo remitente **sin exponer el número**. |

### 6.2 Línea de resumen por evento

```json
{
  "level": "INFO",
  "message": "[WhatsApp Capture] Resumen de evento",
  "total": 3,
  "captured": 1,
  "ignored": 2,
  "error": 0,
  "byReason": { "stored": 1, "type_not_supported": 2 },
  "suppressed": 0,
  "captureEnabled": true,
  "phoneNumberIdMatch": true
}
```

`suppressed` indica cuántas líneas de detalle se omitieron por el tope de
volumen (25 por evento); los conteos del resumen **nunca** se truncan.

### 6.3 Vocabulario de motivos

| Motivo | Origen | Significado |
|---|---|---|
| `stored` | servicio | Mensaje capturado y cifrado en Redis. |
| `type_not_supported` | ruta | El tipo de mensaje no es `text` (botón, interactiva, imagen, …). |
| `empty_body` | ruta | El texto venía vacío o solo con espacios. |
| `missing_metadata` | ruta | Meta no envió `metadata.phone_number_id`: no se puede validar el número destino. |
| `phone_number_not_allowed` | servicio | El `phone_number_id` no es el autorizado. |
| `duplicate` | servicio | Meta ya había entregado ese mensaje (mismo `wamid`). |
| `disabled_by_flag` | servicio | `WHATSAPP_CAPTURE_ENABLED` no es `true`. |
| `missing_phone_number_id` | servicio | Falta `WHATSAPP_CAPTURE_PHONE_NUMBER_ID`. |
| `missing_encryption_key` | servicio | Falta `WHATSAPP_CAPTURE_ENCRYPTION_KEY`. |
| `weak_encryption_key` | servicio | La clave dedicada es demasiado corta. |
| `reused_credential` | servicio | La clave dedicada coincide con `JWT_SECRET` o `DATABASE_ENCRYPTION_KEY`. |
| `storage_error` | servicio | Redis falló al escribir. |
| `timeout` | servicio | Redis no respondió dentro del presupuesto de 1,5 s. |

### 6.4 Privacidad y volumen

- **Nunca** se registra: cuerpo del mensaje, código de verificación, teléfono en
  claro, `phone_number_id` en claro, token, clave ni `wamid` original.
- El remitente se registra como pseudónimo **HMAC** con la clave de captura
  (o con una sal aleatoria por proceso si la captura está apagada): es
  irreversible por enumeración incluso con el espacio reduced de números.
- Volumen acotado: **1 línea por mensaje, máximo 25 por evento**, más 1 línea de
  resumen. Un remitente que insista con cientos de adjuntos no inunda los logs y
  el resumen conserva los conteos exactos.

### 6.5 Cómo usar los logs para el caso BAIT

```bash
# 1. Ver el resultado y el motivo de cada mensaje entrante
railway logs | grep '"\[WhatsApp Capture\] Mensaje entrante"'

# 2. Confirmar si el número destino coincidía
railway logs | grep '"phoneNumberIdMatch":false'

# 3. Confirmar si dos mensajes vinieron del mismo remitente (comparar senderHash)
railway logs | grep -o '"senderHash":"[a-f0-9]*"' | sort | uniq -c

# 4. Correlacionar un log con el registro capturado (messageIdHash == id)
```

Si `result: "ignored"` y `reason: "type_not_supported"`, el mensaje llegó pero
**no era de texto**: la captura no acepta ese tipo y el flujo SADEL tampoco
(ambas rutas filtran por `type === 'text'`).

---

## 7. Garantías de seguridad implementadas

- **Fail closed:** sin las tres variables obligatorias no se captura nada.
- **Aislamiento por número:** solo se captura para el `phone_number_id` autorizado.
  Los mensajes destinados a otros números de la misma WABA se descartan.
- **Cifrado dedicado:** AES-256-GCM con una clave independiente de `JWT_SECRET` y
  de `DATABASE_ENCRYPTION_KEY`. Si se configura una clave reutilizada, la captura
  se rechaza.
- **Depósito mínimo:** no se guarda el payload de Meta, solo los campos listados
  en la sección 1.
- **Logs limpios:** el backend registra solo conteos y metadatos de diagnóstico
  (tipo, resultado, motivo, coincidencia de número, estado de Redis y
  pseudónimos HMAC). Nunca el texto, ni el código, ni el número completo, ni la
  clave. Ver §6.
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

## 8. Comportamiento con Meta

- La **URL del webhook no cambia**. No hay que tocar nada en Meta.
- La **firma HMAC** (`X-Hub-Signature-256`) se sigue validando igual. Un evento
  con firma inválida se rechaza con `401` y **no** se captura.
- Meta **no reenvía** eventos ya entregados: por eso la captura solo sirve para
  mensajes que lleguen **después** de activarla. Los mensajes anteriores a la
  activación no son recuperables desde SaDeL.
- Reenviar un mensaje desde el propio WhatsApp del remitente es la forma más
  simple de probar la captura sin pedir nada a terceros.

---

## 9. Reversión completa (eliminar la función)

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
packages/backend/src/services/whatsapp-capture-diagnostics.ts
packages/backend/src/routes/admin-whatsapp-capture.routes.ts
packages/backend/src/routes/whatsapp-capture.integration.test.ts
packages/backend/src/routes/whatsapp-capture-diagnostics.integration.test.ts
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

## 10. Diagnóstico rápido

> Desde la Fase 1 (observabilidad) el diagnóstico ya no depende de inferir: cada
> mensaje entrante deja una línea con su resultado y su motivo. Empieza por
> `grep '"[WhatsApp Capture] Mensaje entrante"'` en los logs de Railway.

| Síntoma | Causa probable | Qué revisar |
|---|---|---|
| `404 CAPTURE_DISABLED` | Flag apagado o variables faltandas | `WHATSAPP_CAPTURE_ENABLED` y las otras dos obligatorias en Railway |
| `200` pero `total: 0` | El mensaje no se capturó | Línea `[WhatsApp Capture] Mensaje entrante` del mismo instante: `reason` dice por qué |
| `200` pero `total: 0` y hubo log `[WhatsApp Webhook] Captura temporal {"captured":1}` | Se capturó y expiró antes de consultar | TTL vs. tiempo transcurrido |
| `reason: "type_not_supported"` | El mensaje no era de texto (botón, interactiva, imagen, …) | Tipo declarado por Meta; ni la captura ni el flujo SADEL aceptan ese tipo |
| `reason: "phone_number_not_allowed"` / `phoneNumberIdMatch: false` | Llegó a otro número de la WABA | `WHATSAPP_CAPTURE_PHONE_NUMBER_ID` vs. el `phone_number_id` del evento |
| `reason: "missing_metadata"` | Meta no envió `metadata.phone_number_id` | Payload del evento |
| `reason: "disabled_by_flag"` | La captura estaba apagada en ese instante | Reinicio/despliegue de Railway |
| `reason: "storage_error"` / `redis: "error"` | Redis falló al escribir | Salud de Redis en Railway |
| `reason: "timeout"` / `redis: "timeout"` | Redis no respondió en 1,5 s | Latencia de Redis |
| `reason: "duplicate"` | Meta reentregó el mismo mensaje | Normal en reintentos de Meta |
| El webhook devuelve `401` | Firma inválida | `WHATSAPP_WEBHOOK_APP_SECRET` sin cambios respecto a Meta |
