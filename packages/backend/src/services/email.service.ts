import nodemailer, { Transporter } from 'nodemailer';
import { logger } from '../utils/logger';
import { externalServicesEnabled } from '../config/isolation';

// RSEND_API_KEY activa el envío por la API HTTPS de Resend (funciona incluso en
// redes que bloquean SMTP saliente, p. ej. Railway).
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'SaDeL <no-reply@sadel.mx>';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const SMTP_FROM = process.env.SMTP_FROM || 'SaDeL <no-reply@sadel.mx>';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!externalServicesEnabled()) return null;
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
  if (!externalServicesEnabled()) return false;
  return Boolean(RESEND_API_KEY || (SMTP_HOST && SMTP_USER && SMTP_PASSWORD));
}

function buildOtpText(code: string): string {
  return [
    `Hola,\n\n`,
    `Tu codigo de verificacion SaDeL es: ${code}\n`,
    `Es valido por 5 minutos. Si no lo solicitaste, ignora este correo y no lo compartas con nadie.\n\n`,
    `— Equipo SaDeL`,
  ].join('');
}

// Envío por la API HTTPS de Resend (https://api.resend.com/emails).
async function sendViaResend(to: string, subject: string, text: string): Promise<boolean> {
  if (!externalServicesEnabled()) return false;
  if (!RESEND_API_KEY) return false;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to,
        subject,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error('[EMAIL] Resend API error', { status: res.status, body });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('[EMAIL] Error llamando a la API de Resend', { to, error });
    return false;
  }
}

async function sendViaSmtp(to: string, subject: string, text: string): Promise<boolean> {
  const client = getTransporter();
  if (!client) return false;

  try {
    await client.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
    });
    return true;
  } catch (error) {
    logger.error('[EMAIL] Error al enviar OTP por correo (SMTP)', { to, error });
    return false;
  }
}

export async function sendOtpEmail(to: string, code: string): Promise<{ ok: boolean; email: string }> {
  if (!isEmailConfigured()) {
    logger.error('[EMAIL] Email no configurado: define RESEND_API_KEY o SMTP_HOST/USER/PASSWORD.');
    return { ok: false, email: to };
  }

  const subject = 'Tu codigo de verificacion SaDeL';
  const text = buildOtpText(code);

  const ok = (await sendViaResend(to, subject, text)) || (await sendViaSmtp(to, subject, text));
  return { ok, email: to };
}
