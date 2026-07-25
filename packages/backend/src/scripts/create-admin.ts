import { UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { prisma } from '../config/database';

async function createAdmin() {
  const email = 'admin@sadel.com';
  const phone = '+5215500000000';
  const password = await bcrypt.hash('admin123', 10);

  try {
    const adminUser = await prisma.user.upsert({
      where: { email },
      update: {
        password,
        name: 'Administrador Principal',
        role: UserRole.ADMIN,
        admin: {
          upsert: {
            create: {},
            update: {}
          }
        }
      },
      create: {
        email,
        phone,
        password,
        name: 'Administrador Principal',
        role: UserRole.ADMIN,
        region: 'MX-CDMX',
        status: UserStatus.ACTIVE,
        admin: {
          create: {}
        }
      }
    });
    console.log('✅ Admin creado exitosamente:');
    console.log('------------------------------');
    console.log('Teléfono:', adminUser.phone);
    console.log('Contraseña: admin123');
    console.log('Rol:', adminUser.role);
    console.log('------------------------------');
    console.log('Puedes usar este número y contraseña para iniciar sesión en el panel de administrador.');
  } catch (error) {
    console.error('❌ Error creando admin:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
