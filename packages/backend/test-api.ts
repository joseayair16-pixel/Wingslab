import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const secret = process.env.JWT_SECRET || 'your_secret_key_change_in_production_immediately';

async function run() {
  try {
    const restaurant = await prisma.restaurant.findFirst({
      include: { user: true }
    });

    if (!restaurant) {
      console.log('No restaurant found');
      return;
    }

    console.log(`Found restaurant: ${restaurant.name}, User ID: ${restaurant.userId}`);

    const payload = {
      sub: restaurant.userId,
      phone: restaurant.user.phone,
      role: 'RESTAURANT'
    };

    const token = jwt.sign(payload, secret, { expiresIn: '1h' });

    console.log(`Fetching profile via API...`);
    
    const response = await fetch('http://localhost:3001/restaurant-panel/perfil', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const status = response.status;
    const body = await response.text();

    console.log(`Response Status: ${status}`);
    console.log(`Response Body:`);
    console.log(body);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
