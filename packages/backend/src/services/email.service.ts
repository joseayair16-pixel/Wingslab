import nodemailer, { Transporter } from 'nodemailer';
import { logger } from '../utils/logger';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const SMTP_FROM = process.env.SMTP_FROM || 'SaDeL <no-reply@sadel.mx>';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
      // En entornos donde la salida SMTP está bloqueada (p. ej. Railway), falla
      // rápido y deja que el flujo caiga al siguiente canal en vez de colgar.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
}

export function isEmailConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);
}

function buildOtpText(code: string): string {
  return [
    `Hola,\n\n`,
    `Tu codigo de verificacion SaDeL es: ${code}\n`,
    `Es valido por 5 minutos. Si no lo solicitaste, ignora este correo y no lo compartas con nadie.\n\n`,
    `— Equipo SaDeL`,
  ].join('');
}

export async function sendOtpEmail(to: string, code: string): Promise<{ ok: boolean; email: string }> {
  const client = getTransporter();
  if (!client) {
    logger.error('[EMAIL] SMTP no configurado: define SMTP_HOST, SMTP_USER y SMTP_PASSWORD.');
    return { ok: false, email: to };
  }

  try {
    await client.sendMail({
      from: SMTP_FROM,
      to,
      subject: 'Tu codigo de verificacion SaDeL',
      text: buildOtpText(code),
    });
    return { ok: true, email: to };
  } catch (error) {
    logger.error('[EMAIL] Error al enviar OTP por correo', { to, error });
    return { ok: false, email: to };
  }
}