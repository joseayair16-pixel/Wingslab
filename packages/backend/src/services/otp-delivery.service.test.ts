jest.mock('./email.service');
jest.mock('./sms.service');

import { deliverOtp } from './otp-delivery.service';
import { isEmailConfigured, sendOtpEmail } from './email.service';
import { isSmsConfigured, sendSmsOtp } from './sms.service';

const mockIsConfigured = isEmailConfigured as jest.MockedFunction<typeof isEmailConfigured>;
const mockSendOtpEmail = sendOtpEmail as jest.MockedFunction<typeof sendOtpEmail>;
const mockIsSmsConfigured = isSmsConfigured as jest.MockedFunction<typeof isSmsConfigured>;
const mockSendSmsOtp = sendSmsOtp as jest.MockedFunction<typeof sendSmsOtp>;

const saved: Record<string, string | undefined> = {};
['NODE_ENV', 'ALLOW_MOCK_OTP_IN_PROD', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'].forEach(
  (k) => { saved[k] = process.env[k]; },
);

function setEnv(partial: Record<string, string | undefined>) {
  Object.keys(saved).forEach((k) => delete process.env[k]);
  Object.entries(partial).forEach(([k, v]) => { if (v !== undefined) process.env[k] = v; });
}

describe('otp-delivery.service', () => {
  afterAll(() => setEnv(saved));

  beforeEach(() => {
    jest.clearAllMocks();
    deactivateSmtp();
    deactivateSms();
  });

  describe('email', () => {
    it('envía por correo si SMTP está configurado y la entrega es exitosa', async () => {
      activateSmtp();
      mockSendOtpEmail.mockResolvedValue({ ok: true, email: 'a@b.com' });
      const r = await deliverOtp({ phone: '5512345678', email: 'a@b.com', code: '123456' });
      expect(r).toEqual({ ok: true, channel: 'email' });
      expect(mockSendOtpEmail).toHaveBeenCalledWith('a@b.com', '123456');
    });

    it('cae a SMS si el correo falla y SMS está configurado', async () => {
      activateSmtp();
      activateSms();
      mockSendOtpEmail.mockResolvedValue({ ok: false, email: 'a@b.com' });
      mockSendSmsOtp.mockResolvedValue(true);
      const r = await deliverOtp({ phone: '5512345678', email: 'a@b.com', code: '123456' });
      expect(r).toEqual({ ok: true, channel: 'sms' });
    });

    it('expone el código en dev aunque no haya email ni SMS', async () => {
      setEnv({ NODE_ENV: 'development' });
      const r = await deliverOtp({ phone: '5512345678', code: '123456' });
      expect(r.ok).toBe(true);
      expect(r.channel).toBe('mock');
      expect(r.mockCode).toBe('123456');
    });
  });

  describe('sms', () => {
    it('envía por SMS si el usuario prefiere SMS y está configurado', async () => {
      mockSsmPreferences();
      mockSendSmsOtp.mockResolvedValue(true);
      const r = await deliverOtp({
        phone: '5512345678',
        code: '123456',
        preferred: 'sms',
      });
      expect(r).toEqual({ ok: true, channel: 'sms' });
      expect(mockSendSmsOtp).toHaveBeenCalledWith('5512345678', '123456');
    });

    it('si SMS falla, cae a correo automáticamente', async () => {
      activateSmtp();
      mockSendSmsOtp.mockResolvedValue(false);
      mockSendOtpEmail.mockResolvedValue({ ok: true, email: 'a@b.com' });
      const r = await deliverOtp({
        phone: '5512345678',
        email: 'a@b.com',
        code: '123456',
        preferred: 'sms',
      });
      expect(r).toEqual({ ok: true, channel: 'email' });
    });
  });

  describe('gating en producción', () => {
    it('no filtra el código en producción sin canal real', async () => {
      setEnv({ NODE_ENV: 'production' });
      const r = await deliverOtp({ phone: '5512345678', email: 'a@b.com', code: '123456' });
      expect(r).toEqual({ ok: false, channel: 'mock' });
    });

    it('no imprime el código OTP en producción sin canal real', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      setEnv({ NODE_ENV: 'production', ALLOW_MOCK_OTP_IN_PROD: undefined });
      await deliverOtp({ phone: '5512345678', email: 'a@b.com', code: '123456' });
      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('sí imprime el código en desarrollo sin canal real (modo simulación)', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      setEnv({ NODE_ENV: 'development' });
      await deliverOtp({ phone: '5512345678', code: '123456' });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('123456'));
      logSpy.mockRestore();
    });

    it('sí filtra el código en producción cuando ALLOW_MOCK_OTP_IN_PROD=true', async () => {
      setEnv({ NODE_ENV: 'production', ALLOW_MOCK_OTP_IN_PROD: 'true' });
      const r = await deliverOtp({ phone: '5512345678', code: '123456' });
      expect(r.ok).toBe(true);
      expect(r.channel).toBe('mock');
      expect(r.mockCode).toBe('123456');
    });
  });
});

function activateSmtp() {
  setEnv({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASSWORD: 'p' });
  mockIsConfigured.mockReturnValue(true);
}
function deactivateSmtp() {
  setEnv({ SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '' });
  mockIsConfigured.mockReturnValue(false);
}
function activateSms() {
  mockIsSmsConfigured.mockReturnValue(true);
}
function deactivateSms() {
  mockIsSmsConfigured.mockReturnValue(false);
}
function mockSsmPreferences() {
  deactivateSmtp();
  activateSms();
}