// prisma/seed.js
// Seed database with initial data for development/testing

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding test data...');
  
  // Create a test user if not exists
  const testUser = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: '$2a$10$GILYzuJ3V4X5U5QUQkRbsuuRr7A6t0KRK8JpUlCS4YTGMgvhh6vXm', // 'password123'
    },
  });
  
  console.log(`Created test user: ${testUser.id}`);
  
  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 