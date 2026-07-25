import { logger } from '../utils/logger';

/**
 * Servicio para envío de SMS.
 * Integra aquí tu proveedor de SMS (Twilio, AWS SNS, Infobip, etc.).
 */
export async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  try {
    // Normalizar formato del teléfono
    const digitsOnly = phone.replace(/\D/g, '');
    const fullPhone = digitsOnly.startsWith('+') ? digitsOnly : `+52${digitsOnly.slice(-10)}`;

    logger.info(`[SMS Service] Intentando enviar OTP a ${fullPhone}`);

    // ==========================================
    // INTEGRACIÓN CON TU PROVEEDOR AQUÍ:
    // ==========================================
    // Ejemplo con Twilio:
    // const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    // await twilio.messages.create({
    //   body: `Tu código de verificación de SaDeL es: ${code}. Vence en 5 minutos.`,
    //   to: fullPhone,
    //   from: process.env.TWILIO_PHONE_NUMBER
    // });
    
    // Mientras integras tu proveedor, logueamos el código de manera segura
    console.log(`\n--- [SMS SIMULATOR] ---`);
    console.log(`Para: ${fullPhone}`);
    console.log(`Código OTP: ${code}`);
    console.log(`-----------------------\n`);

    return true;
  } catch (error) {
    logger.error('Error al enviar SMS OTP:', error);
    return false;
  }
}
