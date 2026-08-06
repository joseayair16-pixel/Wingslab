import { prisma } from '../config/database';

// All data tables that get wiped. Kept untouched: User (only non-admin rows are
// deleted), Admin, Region, StoreCategory, SystemSetting, _prisma_migrations.
const DATA_TABLES = [
  'RestaurantBillingSettlement',
  'DriverBillingSettlement',
  'CustomerBillingSettlement',
  'OperatingHours',
  'MenuCategory',
  'Product',
  'Customer',
  'Address',
  'Order',
  'OrderItem',
  'OrderTracking',
  'Driver',
  'Transaction',
  'RestaurantStats',
  'DriverStats',
  'DailyStats',
  'Review',
  'FavoriteRestaurant',
  'PushSubscription',
  'RefreshToken',
  'SupportTicket',
  'DeliveryToken',
  'ProductOptionGroup',
  'ProductOption',
  'OrderItemOption',
  'OrderMessage',
  'RestaurantStoreCategory',
  'PlatformRequest',
  'AuditLog',
  'Promotion',
  'Billboard',
  'FeaturedPurchase',
  'Restaurant',
];

async function countTable(name: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT count(*)::bigint AS c FROM "${name}"`
  );
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Seguridad: agrega --confirm para ejecutar el reset.');
    process.exit(1);
  }

  console.log('=== ANTES ===');
  const before: Record<string, number> = {};
  for (const t of DATA_TABLES) before[t] = await countTable(t);
  before['User'] = await countTable('User');
  for (const [t, c] of Object.entries(before)) console.log(`  ${t}: ${c}`);

  await prisma.$transaction(async (tx) => {
    const list = DATA_TABLES.map((t) => `"${t}"`).join(', ');
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
    await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE role::text <> 'ADMIN';`);
  });

  console.log('=== DESPUÉS ===');
  for (const t of DATA_TABLES) console.log(`  ${t}: ${await countTable(t)}`);
  console.log(`  User: ${await countTable('User')}`);
  console.log(`  Admin: ${await countTable('Admin')}`);
  console.log(`  Region: ${await countTable('Region')}`);
  console.log(`  StoreCategory: ${await countTable('StoreCategory')}`);
  console.log(`  SystemSetting: ${await countTable('SystemSetting')}`);
  console.log('Reset completado.');
}

main()
  .catch((err) => {
    console.error('Error en reset:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
