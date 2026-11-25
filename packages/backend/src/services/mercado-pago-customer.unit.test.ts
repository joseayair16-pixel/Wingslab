import {
  createMercadoPagoCustomer, deleteMercadoPagoCard, findMercadoPagoCustomer,
  listMercadoPagoCards, sandboxPayerEmail, saveMercadoPagoCard,
} from './mercado-pago-customer';

const card = {
  id: 'card_123',
  last_four_digits: '0001',
  expiration_month: 12,
  expiration_year: 2030,
  payment_method: { id: 'visa', name: 'Visa', payment_type_id: 'credit_card' },
  issuer: { id: '3' },
};

afterEach(() => jest.restoreAllMocks());

test('usa correo sintético estable del comprador de prueba, sin derivarlo del correo real', () => {
  const first = sandboxPayerEmail('customer-profile-id');
  expect(first).toMatch(/^test_payer_\d{1,10}@testuser\.com$/);
  expect(sandboxPayerEmail('customer-profile-id')).toBe(first);
  expect(sandboxPayerEmail('another-profile-id')).not.toBe(first);
});

test('busca cliente por correo y crea solo el necesario', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 'mp-customer-1' }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'mp-customer-2' }), { status: 201 }));
  await expect(findMercadoPagoCustomer('test-access', 'test_payer_1@testuser.com')).resolves.toEqual({ id: 'mp-customer-1' });
  await expect(createMercadoPagoCustomer('test-access', 'test_payer_2@testuser.com', 'Test', 'Buyer')).resolves.toEqual({ id: 'mp-customer-2' });
  expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/customers/search?email=test_payer_1%40testuser.com');
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ email: 'test_payer_2@testuser.com', first_name: 'Test', last_name: 'Buyer' });
});

test('lista tarjetas y devuelve solo campos reconocidos por el contrato', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ ...card, issuer: { id: 3 }, cardholder: { identification: { number: 'sensitive' } }, token: 'must-not-escape' }])));
  const result = await listMercadoPagoCards('test-access', 'mp-customer/1');
  expect(result).toEqual([card]);
  expect(JSON.stringify(result)).not.toContain('sensitive');
  expect(JSON.stringify(result)).not.toContain('must-not-escape');
});

test('guarda el token solo en la solicitud efímera y elimina por cliente y tarjeta', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...card, issuer: { id: 3 } }), { status: 201 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }));
  await expect(saveMercadoPagoCard('test-access', 'mp-customer-1', 'one-time-token')).resolves.toEqual(card);
  await deleteMercadoPagoCard('test-access', 'mp-customer-1', 'card_123');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ token: 'one-time-token' });
  expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.mercadopago.com/v1/customers/mp-customer-1/cards/card_123');
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
});

test('falla de forma segura con respuestas HTTP o contratos inesperados', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not json', { status: 401 }));
  await expect(listMercadoPagoCards('test-access', 'mp-customer-1')).rejects.toThrow('HTTP 401');
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ ...card, last_four_digits: '123' }])));
  await expect(listMercadoPagoCards('test-access', 'mp-customer-1')).rejects.toThrow();
});
