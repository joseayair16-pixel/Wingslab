process.env.DATABASE_URL = 'postgresql://sadel_user:sadel_password_dev@127.0.0.1:5433/sadel_db';
import '../config/blocked-operation';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const settlement = await prisma.restaurantBillingSettlement.findFirst({
    where: { reference: 'SET-2026-06-15-TACOS' },
  });

  if (!settlement) {
    console.error('Settlement SET-2026-06-15-TACOS not found!');
    return;
  }

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 3); // 3 days ago

  const updated = await prisma.restaurantBillingSettlement.update({
    where: { id: settlement.id },
    data: {
      status: 'OVERDUE',
      dueDate: pastDate,
    },
  });

  console.log('Successfully set settlement to OVERDUE:', updated);
}

main().catch(console.error).finally(() => prisma.$disconnect());
