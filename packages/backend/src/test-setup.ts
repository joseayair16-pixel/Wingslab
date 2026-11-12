/**
 * Setup de Jest para correr la suite sin depender del entorno del shell.
 *
 * Fase 2a: `encrypt()` ya no degrada a un fallback hardcodeado; sin una clave
 * cifra y lanza. Aquí se fijan claves de prueba por defecto (si no están
 * definidas) para que los tests sean deterministas localmente. En CI se
 * reemplazan por las variables reales.
 */
const defaultTestEnv: Record<string, string> = {
  DATABASE_ENCRYPTION_KEY: 'ci-test-db-encryption-key',
  JWT_SECRET: 'ci-test-secret-key-not-for-production',
  // El webhook de WhatsApp lee su app secret y su token de verificación al
  // cargar el módulo, por eso se fijan aquí (no en cada test) para que las
  // pruebas puedan firmar payloads válidos.
  WHATSAPP_WEBHOOK_APP_SECRET: 'ci-test-whatsapp-app-secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'ci-test-whatsapp-verify-token',
};

for (const [key, value] of Object.entries(defaultTestEnv)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}