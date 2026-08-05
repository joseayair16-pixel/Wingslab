import { logger } from '../utils/logger';

const SMS_360NRS_USER = process.env.SMS_360NRS_USER || '';
const SMS_360NRS_PASSWORD = process.env.SMS_360NRS_PASSWORD || '';
const SMS_360NRS_FROM = process.env.SMS_360NRS_FROM || 'SADEL';
const SMS_360NRS_HOST =
  process.env.SMS_360NRS_HOST || 'https://dashboard.360nrs.com';

export function isSmsConfigured(): boolean {
  return Boolean(SMS_360NRS_USER && SMS_360NRS_PASSWORD);
}

// Convierte un teléfono local (10 dígitos MX) al formato internacional sin '+'
function toE164(phone: string): string {
  return `52${phone.replace(/\D/g, '')}`;
}

function buildOtpText(code: string): string {
  return `SaDeL: Tu codigo de verificacion es ${code}. Vence en 5 minutos. Si no lo solicitaste, ignora este mensaje.`;
}

export async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  if (!isSmsConfigured()) {
    logger.error('[SMS] 360NRS no configurado: define SMS_360NRS_USER y SMS_360NRS_PASSWORD.');
    return false;
  }

  const basic = Buffer.from(`${SMS_360NRS_USER}:${SMS_360NRS_PASSWORD}`).toString('base64');

  try {
    const response = await fetch(`${SMS_360NRS_HOST}/api/rest/sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({
        to: [toE164(phone)],
        from: SMS_360NRS_FROM,
        message: buildOtpText(code),
        encoding: 'gsm',
      }),
    });

    if (response.status === 200 || response.status === 202) {
      return true;
    }

    logger.error('[SMS] 360NRS error', { status: response.status, body: await response.text() });
    return false;
  } catch (error) {
    logger.error('[SMS] 360NRS excepción', error);
    return false;
  }
}