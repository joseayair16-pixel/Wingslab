import type { PrismaClient } from '@prisma/client';
import { getScanStatus, previewInPerson, registerInPersonStamp, voidInPerson } from './loyalty-inperson.service';
import { findLoyaltyGift, loyaltyState } from './loyalty-runtime.service';

jest.mock('./loyalty-runtime.service', () => ({
  loyaltyState: jest.fn(),
  findLoyaltyGift: jest.fn(),
}));

const session = { id: 'session-1', customerId: 'customer-1' };
const input = { code: 'fixture-code', staffUserId: 'staff-1' };

function fixture(stamps: number) {
  const open = { id: 'active-card', goal: 8, stamps, rewardDescription: 'Papas de regalo', rewardKind: 'PRODUCT', rewardProductId: 'papas', rewardValue: null };
  const state = {
    open, next: { id: 'older-card', goal: 3, rewardDescription: 'Otro premio' }, reserved: false,
    program: { enabled: true, programVersion: 2, stampGoal: 10, rewardDescription: 'Premio de otra versión' },
  };
  (loyaltyState as jest.Mock).mockResolvedValue(state);
  (findLoyaltyGift as jest.Mock).mockResolvedValue({ id: 'papas', name: 'Papas', trackStock: true, stock: 3 });
  let claimed = false;
  let visit: Record<string, unknown> | null = null;
  const tx = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const text = sql.join('');
      if (text.includes('pg_advisory_xact_lock')) return [];
      if (text.includes('UPDATE "LoyaltyScanSession"')) {
        if (claimed) return [];
        claimed = true;
        return [session];
      }
      if (text.includes('FROM "LoyaltyScanSession"')) return claimed && values[2] ? [] : [session];
      throw new Error(`Unexpected query: ${text}`);
    }),
    loyaltyVisit: {
      create: jest.fn(async ({ data }) => { visit = data; }),
      update: jest.fn(async ({ data }) => { visit = { ...visit, ...data }; }),
      findUnique: jest.fn(async () => visit),
    },
    loyaltyCard: { update: jest.fn() },
    loyaltyStamp: { create: jest.fn() },
    loyaltyRedemption: { create: jest.fn() },
    product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    customer: { findUniqueOrThrow: jest.fn().mockResolvedValue({ user: { name: 'Ana', lastName: 'Prueba' } }) },
    auditLog: { create: jest.fn() },
  };
  const db = {
    $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
      const previousClaim = claimed;
      try { return await run(tx); }
      catch (reason) { claimed = previousClaim; throw reason; }
    },
  } as unknown as PrismaClient;
  return { db, tx, state };
}

afterEach(() => jest.clearAllMocks());

test('verifica el progreso de la tarjeta activa y registra solo un sello aunque se repita el QR', async () => {
  const { db, tx } = fixture(5);
  const preview = await previewInPerson(db, input.code);
  expect(preview).toMatchObject({ customerName: 'Ana Prueba', stamps: 5, goal: 8, rewardDescription: 'Papas de regalo', completesCard: false });
  expect(tx.loyaltyStamp.create).not.toHaveBeenCalled();

  const request = { ...input, previewKey: preview.previewKey, deliverReward: false };
  const first = await registerInPersonStamp(db, request);
  expect(first).toMatchObject({ stamps: 6, completed: false, rewardDelivered: false });
  await expect(registerInPersonStamp(db, request)).resolves.toEqual(first);
  await expect(registerInPersonStamp(db, { ...request, staffUserId: 'another-staff' })).rejects.toMatchObject({ code: 'LOYALTY_CODE_INVALID' });
  expect(tx.loyaltyStamp.create).toHaveBeenCalledTimes(1);
  expect(tx.loyaltyVisit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amountCents: 0, scanSessionId: session.id }) });
  expect(tx.product.updateMany).not.toHaveBeenCalled();
  expect(tx.loyaltyRedemption.create).not.toHaveBeenCalled();
});

test('en el último sello completa la tarjeta y registra la entrega del premio de esa misma tarjeta', async () => {
  const { db, tx } = fixture(7);
  const preview = await previewInPerson(db, input.code);
  expect(preview).toMatchObject({ completesCard: true, rewardDescription: 'Papas de regalo', rewardBlockedReason: null });

  await expect(registerInPersonStamp(db, { ...input, previewKey: preview.previewKey, deliverReward: true }))
    .resolves.toMatchObject({ stamps: 8, goal: 8, completed: true, rewardDelivered: true });
  expect(tx.loyaltyCard.update).toHaveBeenCalledWith({ where: { id: 'active-card' }, data: expect.objectContaining({ state: 'COMPLETED' }) });
  expect(tx.loyaltyRedemption.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cardId: 'active-card', state: 'COMPLETED' }) });
  expect(tx.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'papas' }), data: { stock: { decrement: 1 } } }));
});

test('si cambió el progreso o se agotó el premio, no consume el código de forma definitiva', async () => {
  const { db, tx, state } = fixture(6);
  const initial = await previewInPerson(db, input.code);
  state.open.stamps = 7;
  await expect(registerInPersonStamp(db, { ...input, previewKey: initial.previewKey, deliverReward: false }))
    .rejects.toMatchObject({ code: 'LOYALTY_PREVIEW_CHANGED' });
  const updated = await previewInPerson(db, input.code);

  (findLoyaltyGift as jest.Mock).mockResolvedValue(null);
  await expect(registerInPersonStamp(db, { ...input, previewKey: updated.previewKey, deliverReward: true }))
    .rejects.toMatchObject({ code: 'LOYALTY_GIFT_UNAVAILABLE' });
  expect(tx.loyaltyStamp.create).not.toHaveBeenCalled();

  await expect(registerInPersonStamp(db, { ...input, previewKey: updated.previewKey, deliverReward: false }))
    .resolves.toMatchObject({ completed: true, rewardDelivered: false });
  expect(tx.loyaltyRedemption.create).not.toHaveBeenCalled();
});

test('el estado del QR exige el dueño y distingue un QR sustituido de un sello confirmado', async () => {
  const findFirst = jest.fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ consumedAt: new Date(), visit: null })
    .mockResolvedValueOnce({ consumedAt: new Date(), visit: { id: 'visit', voidedAt: null, resultJson: '{"stamps":8,"completed":true}',
      stamps: [{ card: { goal: 8, rewardDescription: 'Papas de regalo', terms: '', redemption: { state: 'COMPLETED', visitId: 'visit' } } }],
    } });
  const db = { loyaltyScanSession: { findFirst } } as unknown as PrismaClient;
  await expect(getScanStatus(db, 'otro-cliente', session.id)).rejects.toMatchObject({ statusCode: 404 });
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: 'otro-cliente', id: session.id }) }));
  await expect(getScanStatus(db, session.customerId, session.id)).resolves.toEqual({ state: 'invalidated' });
  await expect(getScanStatus(db, session.customerId, session.id)).resolves.toMatchObject({ state: 'applied', receipt: { stamps: 8, completed: true, rewardDelivered: true } });
});

test('al agotarse el tiempo vuelve a consultar antes de anunciar un QR vencido', async () => {
  const expired = { expiresAt: new Date(0), consumedAt: null, visit: null };
  const first = jest.fn().mockResolvedValue(expired);
  const afterConfirmation = jest.fn().mockResolvedValue({
    expiresAt: expired.expiresAt, consumedAt: new Date(), visit: {
      id: 'visit', voidedAt: null, resultJson: '{"stamps":1,"completed":false}',
      stamps: [{ card: { goal: 8, rewardDescription: 'Papas de regalo', terms: '', redemption: null } }],
    },
  });
  const $queryRaw = jest.fn();
  const db = {
    loyaltyScanSession: { findFirst: first },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw, loyaltyScanSession: { findFirst: afterConfirmation } }),
  } as unknown as PrismaClient;
  await expect(getScanStatus(db, session.customerId, session.id)).resolves.toMatchObject({ state: 'applied', receipt: { stamps: 1 } });
  expect($queryRaw.mock.calls[0][0].join('')).toContain('FOR SHARE');
});

test('un QR que vence mientras espera el bloqueo del cliente no devuelve la vista previa', async () => {
  const { db, tx } = fixture(3);
  tx.$queryRaw.mockResolvedValueOnce([session]).mockResolvedValueOnce([]);
  await expect(previewInPerson(db, input.code)).rejects.toMatchObject({ code: 'LOYALTY_CODE_INVALID' });
  expect(tx.customer.findUniqueOrThrow).not.toHaveBeenCalled();
});

test('no se puede anular un sello anterior a otro sello de la misma tarjeta', async () => {
  const visit = { customerId: 'customer-1', createdBy: 'staff-1', createdAt: new Date(), voidedAt: null };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ ageMs: 1000 }]),
    loyaltyVisit: { findFirst: jest.fn().mockResolvedValue(visit), findUnique: jest.fn().mockResolvedValue(visit), update: jest.fn() },
    loyaltyCard: { findUnique: jest.fn().mockResolvedValue({ id: 'card-1', sequence: 1, state: 'OPEN' }), count: jest.fn().mockResolvedValue(0) },
    loyaltyStamp: { findFirst: jest.fn().mockResolvedValueOnce({ id: 'stamp-1', cardId: 'card-1', earnedAt: visit.createdAt }).mockResolvedValueOnce({ id: 'stamp-2' }), delete: jest.fn() },
    loyaltyRedemption: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const db = { $transaction: async (run: (value: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaClient;
  await expect(voidInPerson(db, 'visit-1', 'staff-1')).rejects.toMatchObject({ code: 'VISIT_HAS_DEPENDENCIES' });
  expect(tx.loyaltyStamp.delete).not.toHaveBeenCalled();
  expect(tx.loyaltyVisit.update).not.toHaveBeenCalled();
});
