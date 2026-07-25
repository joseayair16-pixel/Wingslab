import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const phone = '5512345678';
  
  // Borrar si ya existe para asegurar que sabemos la contraseña
  const existing = await prisma.user.findFirst({ where: { phone, role: UserRole.CUSTOMER } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log('Usuario existente eliminado.');
  }

  const hashedPassword = await bcrypt.hash('password123', 10);
  
  const user = await prisma.user.create({
    data: {
      email: 'customer@test.com',
      password: hashedPassword,
      phone: phone,
      name: 'Cliente de Prueba',
      role: 'CUSTOMER' as any, // Forzar si el enum da problemas
      region: 'CENTRO',
    },
  });
  
  console.log('Usuario de prueba creado con éxito:', user);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
