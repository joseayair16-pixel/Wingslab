process.env.DATABASE_URL = 'postgresql://sadel_user:sadel_password_dev@127.0.0.1:5433/sadel_db';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    include: {
      billingSettlements: true,
      user: true,
    }
  });

  console.log(`=== RESTAURANTS BILLING STATUS (${restaurants.length} found) ===`);
  for (const r of restaurants) {
    console.log(`\nRestaurant: ${r.name} (${r.id})`);
    console.log(`  User Email: ${r.user.email}`);
    console.log(`  User Password: password (if standard) or custom`);
    console.log(`  Status: ${r.status}`);
    console.log(`  Billing Settlements (${r.billingSettlements.length}):`);
    for (const s of r.billingSettlements) {
      console.log(`    - ID: ${s.id}, Ref: ${s.reference}, Status: ${s.status}, Amount: $${s.amount}, Due: ${s.dueDate?.toISOString()}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
