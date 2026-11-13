describe('notificación saliente WhatsApp Cloud API', () => {
  it('envía la plantilla de pedido mediante Cloud API', async () => {
    const oldToken = process.env.WHATSAPP_API_TOKEN;
    const oldId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const oldFetch = global.fetch;
    try {
      process.env.WHATSAPP_API_TOKEN = 'test-only-token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-only-id';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      jest.resetModules();
      const { sendWhatsAppNewOrder } = await import('./whatsapp.service');
      const result = await sendWhatsAppNewOrder({ restaurantPhone: '5512345678', orderNumber: 1, panelUrl: 'https://example.test' });
      expect(result).toEqual({ sent: true, channel: 'template' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      if (oldToken === undefined) delete process.env.WHATSAPP_API_TOKEN; else process.env.WHATSAPP_API_TOKEN = oldToken;
      if (oldId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID; else process.env.WHATSAPP_PHONE_NUMBER_ID = oldId;
      global.fetch = oldFetch;
    }
  });
});
