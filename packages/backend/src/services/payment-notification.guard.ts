import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

type NotificationField = 'reminderSentAt' | 'suspendedReminderSentAt';

// Reclamación atómica: solo 1 proceso consigue grabar la marca (golpeteo de
// instancias/reinicios). Devuelve true si este llamador "ganó" el derecho a notificar.
export async function claimNotification(
  client: DbClient,
  settlementId: string,
  field: NotificationField,
  when: Date
): Promise<boolean> {
  const result = await client.restaurantBillingSettlement.updateMany({
    where: { id: settlementId, [field]: null },
    data: { [field]: when },
  });
  return result.count > 0;
}

// Si el envío falla se revierte la marca para que el siguiente tick reintente.
export async function releaseNotification(
  client: DbClient,
  settlementId: string,
  field: NotificationField,
  when: Date
): Promise<void> {
  await client.restaurantBillingSettlement.updateMany({
    where: { id: settlementId, [field]: when },
    data: { [field]: null },
  });
}