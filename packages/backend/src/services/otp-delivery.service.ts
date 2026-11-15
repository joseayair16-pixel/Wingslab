import { logger } from '../utils/logger';
import { localOtpSimulationAllowed } from '../config/env';
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

  // Only an identified local runtime or hermetic test may expose a simulated OTP.
  // NODE_ENV controls optimizations, not permission to simulate authentication.
  if (localOtpSimulationAllowed()) {
    logger.warn(
      '[OTP] Sin canal de entrega real (email/SMS): el código solo se muestra en modo simulación.',
    );
    // The caller receives mockCode explicitly; do not print contacts or OTPs.
    return { ok: true, channel: 'mock', mockCode: code };
  }

  // En producción sin bandera no se finge éxito ni se imprime el código.
  logger.warn('[OTP] Sin canal real ni simulador local autorizado.');
  return { ok: false, channel: 'mock' };
}
