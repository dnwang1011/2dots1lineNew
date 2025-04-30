// scripts/init-db.js
// Script to initialize database, run migrations, and seed data

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Make sure we're in the project root
process.chdir(path.join(__dirname, '..'));

console.log('🔍 Checking database configuration...');

try {
  // Check if env file exists
  if (!fs.existsSync('./.env')) {
    console.error('❌ Environment file (.env) not found!');
    process.exit(1);
  }
  
  console.log('✅ Environment file found.');
  console.log('🔄 Running database migrations...');
  
  // Run prisma migrate
  execSync('npx prisma migrate dev --name init', { stdio: 'inherit' });
  
  console.log('✅ Migrations applied successfully.');
  console.log('🌱 Seeding database with initial data...');
  
  // Run prisma seed
  execSync('npx prisma db seed', { stdio: 'inherit' });
  
  console.log('✅ Database seeded successfully.');
  console.log('🔍 Generating Prisma client...');
  
  // Generate Prisma client
  execSync('npx prisma generate', { stdio: 'inherit' });
  
  console.log('✅ Prisma client generated.');
  console.log('✅ Database initialization completed successfully.');
  
} catch (error) {
  console.error('❌ Error initializing database:', error.message);
  process.exit(1);
} 