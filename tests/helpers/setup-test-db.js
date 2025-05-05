// tests/helpers/setup-test-db.js
// Script to set up test database for integration tests

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Define paths to environment files
const ROOT_ENV_TEST_PATH = path.resolve(__dirname, '../env/.env.test');
const PRISMA_ENV_TEST_PATH = path.resolve(__dirname, '../env/prisma.env.test');

// Load test environment variables
dotenv.config({ path: ROOT_ENV_TEST_PATH });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function createTestEnvFile() {
  console.log('Checking for .env.test files...');
  
  // Create test env directory if it doesn't exist
  const testEnvDir = path.resolve(__dirname, '../env');
  if (!fs.existsSync(testEnvDir)) {
    fs.mkdirSync(testEnvDir, { recursive: true });
    console.log('Created tests/env directory.');
  }
  
  if (!fs.existsSync(ROOT_ENV_TEST_PATH)) {
    console.log('Creating main .env.test file...');
    
    const rootEnvContent = `NODE_ENV=test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test_db
JWT_SECRET=test_jwt_secret_for_integration_tests
WEAVIATE_HOST=http://localhost:8080
WEAVIATE_SCHEME=http
REDIS_HOST=localhost
REDIS_PORT=6379
GOOGLE_AI_API_KEY=test_api_key`;
    
    fs.writeFileSync(ROOT_ENV_TEST_PATH, rootEnvContent);
    console.log('Main .env.test file created.');
  } else {
    console.log('Main .env.test file already exists.');
  }
  
  // Create or update the Prisma-specific .env.test file
  if (!fs.existsSync(PRISMA_ENV_TEST_PATH)) {
    console.log('Creating Prisma env test file...');
    
    const prismaEnvContent = `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test_db
# Redis Configuration for BullMQ
REDIS_HOST=localhost
REDIS_PORT=6379`;
    
    fs.writeFileSync(PRISMA_ENV_TEST_PATH, prismaEnvContent);
    console.log('Prisma env test file created.');
  } else {
    console.log('Prisma env test file already exists.');
  }
}

async function runPrismaMigrations() {
  console.log('Running Prisma migrations on test database...');
  
  try {
    const { stdout, stderr } = await execPromise('npx dotenv -e tests/env/.env.test -- npx prisma migrate deploy');
    console.log(stdout);
    if (stderr) console.error(stderr);
    
    console.log('Running prisma generate...');
    const genResult = await execPromise('npx dotenv -e tests/env/.env.test -- npx prisma generate');
    console.log(genResult.stdout);
    if (genResult.stderr) console.error(genResult.stderr);
    
    // Try to add the metadata column to RawData if it doesn't exist
    try {
      console.log('Checking if we need to add metadata column to RawData...');
      await prisma.$executeRaw`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'RawData' AND column_name = 'metadata'
          ) THEN
            ALTER TABLE "RawData" ADD COLUMN metadata JSONB;
          END IF;
        END $$;
      `;
      console.log('Metadata column check completed.');
    } catch (err) {
      console.error('Error adding metadata column:', err.message);
    }
    
    console.log('Migrations applied successfully.');
    return true;
  } catch (error) {
    console.error('Error running migrations:', error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
    return false;
  }
}

async function setupTestDatabase() {
  console.log('Setting up test database...');
  
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    console.log('Test database connection successful.');
    
    // Create test user if it doesn't exist
    const testUserId = uuidv4();
    const testEmail = `test-${testUserId}@example.com`;
    
    // Check if test user exists
    const existingUser = await prisma.user.findFirst({
      where: { email: testEmail }
    });
    
    if (!existingUser) {
      // Hash password for test user
      const passwordHash = await bcrypt.hash('test_password', 10);
      
      // Create test user
      const user = await prisma.user.create({
        data: {
          id: testUserId,
          email: testEmail,
          firstName: 'Test',
          lastName: 'User',
          passwordHash
        }
      });
      
      console.log(`Created test user with ID: ${user.id}`);
      
      // Create test session
      const testSessionId = uuidv4();
      console.log(`Test session ID: ${testSessionId}`);
      
      // Add some initial raw data for the test user
      try {
        // Try creating RawData with basic fields first
        const rawData = await prisma.rawData.create({
          data: {
            content: 'Initial test message content',
            contentType: 'user_message',
            userId: user.id,
            perspectiveOwnerId: user.id,
            sessionId: testSessionId
          }
        });
        console.log('Created initial test data with ID:', rawData.id);
        
        // Try updating with metadata if possible
        try {
          await prisma.rawData.update({
            where: { id: rawData.id },
            data: { metadata: { testData: true } }
          });
          console.log('Updated test data with metadata');
        } catch (metadataError) {
          console.error('Could not update with metadata:', metadataError.message);
        }
        
      } catch (error) {
        console.error('Error creating raw data:', error.message);
        console.log('Continuing with setup...');
      }
      
      // Output the test IDs for use in tests
      console.log('\nTest Environment Setup Complete!\n');
      console.log('Use these IDs in your tests:');
      console.log(`TEST_USER_ID=${user.id}`);
      console.log(`TEST_SESSION_ID=${testSessionId}`);
      
      // Save values to a file for tests to use
      const testEnvContent = `TEST_USER_ID=${user.id}
TEST_SESSION_ID=${testSessionId}`;
      fs.writeFileSync(path.resolve(__dirname, '../.test-env'), testEnvContent);
      
    } else {
      console.log(`Test user already exists with ID: ${existingUser.id}`);
    }
    
  } catch (error) {
    console.error('Error setting up test database:', error);
    throw error;
  }
}

async function main() {
  try {
    await createTestEnvFile();
    const migrationsSuccessful = await runPrismaMigrations();
    if (migrationsSuccessful) {
      await setupTestDatabase();
    } else {
      console.error('Skipping database setup due to migration failures.');
    }
  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// If this script is run directly (not imported)
if (require.main === module) {
  main();
} else {
  // Export for use in tests
  module.exports = { 
    setupTestDatabase,
    createTestEnvFile,
    runPrismaMigrations
  };
} 