process.env.DATABASE_URL = 'postgresql://sadel_user:sadel_password_dev@127.0.0.1:5433/sadel_db';
import { prisma } from '../config/database';

async function runCheck() {
  console.log('[ManualOverdueCheck] Starting check for overdue settlements...');
  const now = new Date();
  
  // 1. Find all PENDING settlements with dueDate <= now and update them to OVERDUE
  const overdueSettlements = await prisma.restaurantBillingSettlement.findMany({
    where: {
      status: 'PENDING',
      dueDate: {
        lte: now,
      },
    },
    include: {
      restaurant: true,
    },
  });

  console.log(`[ManualOverdueCheck] Found ${overdueSettlements.length} pending settlements past due date.`);

  for (const settlement of overdueSettlements) {
    try {
      console.log(`[ManualOverdueCheck] Processing settlement ${settlement.reference} for restaurant ${settlement.restaurant.name}...`);

      // Mark settlement as OVERDUE
      await prisma.restaurantBillingSettlement.update({
        where: { id: settlement.id },
        data: {
          status: 'OVERDUE',
        },
      });

      // Suspend the restaurant if active
      if (settlement.restaurant.status === 'ACTIVE') {
        await prisma.restaurant.update({
          where: { id: settlement.restaurantId },
          data: {
            status: 'SUSPENDED',
            statusReason: `Suspensión automática por pago vencido. Corte: ${settlement.reference}`,
            statusChangedAt: now,
            statusChangedBy: 'SYSTEM_BILLING_OVERDUE',
            isAcceptingOrders: false,
          },
        });
        console.log(`[ManualOverdueCheck] Suspended restaurant ${settlement.restaurant.name} (${settlement.restaurantId}) due to overdue settlement ${settlement.reference}.`);
      } else {
        console.log(`[ManualOverdueCheck] Restaurant ${settlement.restaurant.name} is already in status ${settlement.restaurant.status}. Skipping suspension.`);
      }
    } catch (error) {
      console.error(`[ManualOverdueCheck] Failed to process overdue settlement ${settlement.reference}:`, error);
    }
  }

  // 2. Also suspend any active restaurants that already have OVERDUE settlements
  const restaurantsWithOverdue = await prisma.restaurant.findMany({
    where: {
      status: 'ACTIVE',
      billingSettlements: {
        some: {
          status: 'OVERDUE'
        }
      }
    },
    include: {
      billingSettlements: {
        where: { status: 'OVERDUE' }
      }
    }
  });

  console.log(`[ManualOverdueCheck] Found ${restaurantsWithOverdue.length} active restaurants with overdue status settlements.`);
  for (const r of restaurantsWithOverdue) {
    const overdueRefs = r.billingSettlements.map(s => s.reference).join(', ');
    await prisma.restaurant.update({
      where: { id: r.id },
      data: {
        status: 'SUSPENDED',
        statusReason: `Suspensión automática por pago vencido. Cortes: ${overdueRefs}`,
        statusChangedAt: now,
        statusChangedBy: 'SYSTEM_BILLING_OVERDUE',
        isAcceptingOrders: false,
      }
    });
    console.log(`[ManualOverdueCheck] Suspended restaurant ${r.name} (${r.id}) due to overdue settlements: ${overdueRefs}`);
  }

  console.log('[ManualOverdueCheck] Overdue check completed.');
}

runCheck().catch(console.error).finally(() => prisma.$disconnect());
