import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import bcryptjs from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdmin() {
  const password = await bcryptjs.hash('admin123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@sadel.com' },
    update: {},
    create: {
      email: 'admin@sadel.com',
      phone: '2299999999',  // 10 dígitos solo
      name: 'Administrator',
      password: password,
      role: UserRole.ADMIN,
      region: 'SV-SS',
      status: UserStatus.ACTIVE,
      admin: {
        create: {},
      },
    },
  });

  console.log('✅ Admin creado:');
  console.log('   Email:', admin.email);
  console.log('   Teléfono:', admin.phone);
  console.log('   Contraseña: admin123');
  console.log('   ID:', admin.id);
  console.log('\n   Para iniciar sesión, usa:');
  console.log('   Teléfono: 2299999999');
  console.log('   Contraseña: admin123');
}

createAdmin()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
