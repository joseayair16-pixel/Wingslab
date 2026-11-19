# Firebase SMS para registro y recuperación

El registro de clientes y la recuperación de contraseña verifican el teléfono exclusivamente con Firebase Authentication. Firebase envía y valida el código; el backend valida el ID token de Firebase y conserva las cuentas, contraseñas y sesiones de WingsLab.

## Configuración de Firebase

1. Crear un proyecto Firebase **propio de WingsLab** y agregar una aplicación web.
2. En **Authentication → Sign-in method**, habilitar **Phone**.
3. En la política regional de SMS, permitir únicamente México mientras ese sea el mercado habilitado.
4. Agregar los dominios reales de WingsLab a **Authorized domains**. Para desarrollo, usar números de teléfono ficticios configurados en Firebase; esos números no envían SMS reales.
5. Activar facturación Blaze para SMS reales. No usar credenciales ni proyectos de SaDeL.

## Configuración del runtime

No copiar los ejemplos encima de archivos locales con datos. El runtime monta configuraciones separadas por rol: el backend lee `config/wingslab.local.json`, y el cliente se monta desde `config/wingslab.customer.local.json` como `/app/config/wingslab.local.json` dentro del contenedor.

En `config/wingslab.customer.local.json`, agregar al nivel raíz la configuración web pública de Firebase:

```json
{
  "firebase": {
    "apiKey": "WEB_API_KEY",
    "authDomain": "PROJECT_ID.firebaseapp.com",
    "projectId": "PROJECT_ID",
    "appId": "WEB_APP_ID"
  }
}
```

Para probar exclusivamente en Docker/local con un número ficticio de Firebase, se puede agregar dentro de `firebase` el bloque local opcional siguiente. No se configura en producción. Además de ese opt-in, el servidor exige el runtime local autorizado, el perfil de contenedor y un `Host` loopback; el cliente vuelve a comprobar loopback y rechaza cualquier teléfono distinto del ficticio indicado. El `NODE_ENV=production` usado para optimizar el Docker local no habilita este modo: `WINGSLAB_ENVIRONMENT` debe seguir siendo `local`.

```json
{
  "firebase": {
    "phoneAuthTest": {
      "enabled": true,
      "phoneNumber": "+52XXXXXXXXXX"
    }
  }
}
```

El código de prueba no se guarda en WingsLab ni se envía desde la configuración: se introduce manualmente en el formulario. La configuración web se entrega al navegador desde una ruta runtime `no-store`, por lo que el build Docker no necesita incluir valores Firebase ni credenciales.

En `config/wingslab.local.json`, bajo `backend`, agregar una cuenta de servicio dedicada:

```json
{
  "backend": {
    "firebaseAuth": {
      "projectId": "PROJECT_ID",
      "clientEmail": "firebase-adminsdk-...@PROJECT_ID.iam.gserviceaccount.com",
      "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
    }
  }
}
```

La cuenta de servicio debe pertenecer al mismo proyecto y tener permisos de Firebase Authentication Admin para verificar tokens y consultar su revocación. La clave privada solo se inyecta al backend; nunca se incluye en la configuración pública del navegador. La configuración de ejemplo está en `config/wingslab.local.example.json` (backend) y `config/wingslab.frontend.example.json` (frontend).

El navegador necesita HTTPS hacia los servicios de Firebase/Google autorizados por la CSP. El backend también requiere DNS y salida HTTPS a los endpoints de certificados de Google y Firebase Auth para validar ID tokens y revocación; no se debe abrir acceso entrante a Firebase ni reutilizar una cuenta de servicio de SaDeL.

## Pruebas y despliegue

- En Firebase, agregar números ficticios y códigos de prueba para desarrollo y CI. No se envían SMS ni se consume cuota con esos números.
- Para SMS reales, verificar dominios autorizados, política regional MX y facturación Blaze.
- Configurar alertas de presupuesto y límites de envío en WingsLab/Firebase; las alertas no necesariamente detienen el gasto.
- El frontend debe reconstruirse después de configurar sus valores públicos `NEXT_PUBLIC_FIREBASE_*`; Next.js los incorpora durante el build.

El backend ofrece `POST /auth/sms-otp/iniciar` y `POST /auth/sms-otp/confirmar`. Los endpoints heredados de OTP por correo y verificación WhatsApp de clientes responden `410 AUTH_SMS_REQUIRED`.
