import { logger } from '../utils/logger';
import { isEmailConfigured, sendOtpEmail } from './email.service';
import { isSmsConfigured, sendSmsOtp } from './sms.service';

export type OtpChannel = 'email' | 'sms' | 'mock';

export interface OtpDeliveryResult {
  ok: boolean;
  channel: OtpChannel;
  // Solo se expone en modo simulación (mock) cuando está permitido
  mockCode?: string;
}

export async function deliverOtp(params: {
  phone: string;
  email?: string;
  code: string;
  // Canal preferido por el usuario: por defecto el correo
  preferred?: 'email' | 'sms';
}): Promise<OtpDeliveryResult> {
  const { phone, email, code, preferred = 'email' } = params;

  const tryEmail = async (): Promise<OtpDeliveryResult | null> => {
    if (!email || !isEmailConfigured()) return null;
    const result = await sendOtpEmail(email, code);
    if (result.ok) return { ok: true, channel: 'email' as const };
    return null;
  };

  const trySms = async (): Promise<OtpDeliveryResult | null> => {
    if (!isSmsConfigured()) return null;
    const ok = await sendSmsOtp(phone, code);
    if (ok) return { ok: true, channel: 'sms' as const };
    return null;
  };

  const preferredFirst = preferred === 'sms' ? trySms : tryEmail;
  const fallback = preferred === 'sms' ? tryEmail : trySms;

  const result = (await preferredFirst()) ?? (await fallback());
  if (result) return result;

  // Sin canal real disponible: modo simulación (dev) o error claro en producción
  logger.warn(
    '[OTP] Sin canal de entrega real (email/SMS): el código solo se muestra en modo simulación.',
  );
  console.log(`\n--- [OTP SIMULATOR] ---`);
  console.log(`Para: ${email ?? 'sin email'} / tel ${phone}`);
  console.log(`Código OTP: ${code}`);
  console.log(`------------------------\n`);

  // Se lee en cada llamada para permitir config/entornos dinámicos (y tests).
  const allowMockInProd = process.env.ALLOW_MOCK_OTP_IN_PROD === 'true';

  if (process.env.NODE_ENV !== 'production' || allowMockInProd) {
    return { ok: true, channel: 'mock', mockCode: code };
  }

  return { ok: false, channel: 'mock' };
}