// tests/e2e/scripts/reset_and_seed.js
// Script to reset the database and seed it with test data

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const logger = require('../../../src/utils/logger').childLogger('E2ETestSeeder');

// Initialize Prisma client
const prisma = new PrismaClient();

// Test user constants - Use fixed values for consistent login
const TEST_USER_EMAIL = 'e2e-test@example.com';
const TEST_USER_PASSWORD = 'testpassword123';
const TEST_USER_ID = process.env.TEST_USER_ID || '00000000-0000-4000-a000-000000000001'; // Fixed UUID
const TEST_SESSION_ID = process.env.TEST_SESSION_ID || 'e2e-test-session';

/**
 * Reset the database tables related to memory pipeline
 */
async function resetDatabase() {
  logger.info('Resetting database for e2e tests...');
  
  try {
    // Get the user ID by email first
    const existingUser = await prisma.user.findUnique({
      where: { email: TEST_USER_EMAIL }
    });
    
    const userIdToClean = existingUser ? existingUser.id : TEST_USER_ID;
    
    // Delete in the correct order to respect foreign key constraints
    await prisma.episodeThought.deleteMany({
      where: { episode: { userId: userIdToClean } }
    });
    
    await prisma.chunkEpisode.deleteMany({
      where: { chunk: { userId: userIdToClean } }
    });
    
    await prisma.thought.deleteMany({
      where: { userId: userIdToClean }
    });
    
    await prisma.episode.deleteMany({
      where: { userId: userIdToClean }
    });
    
    await prisma.chunkEmbedding.deleteMany({
      where: { userId: userIdToClean }
    });
    
    await prisma.rawData.deleteMany({
      where: { userId: userIdToClean }
    });
    
    // Now that all dependent records are deleted, delete the user
    if (existingUser) {
      await prisma.user.delete({
        where: { id: existingUser.id }
      });
      logger.info(`Deleted existing test user: ${existingUser.id} (${existingUser.email})`);
    }
    
    logger.info('Database reset complete');
  } catch (error) {
    console.error('Detailed error:', error);
    logger.error('Error resetting database:', { error });
    throw error;
  }
}

/**
 * Seed the database with initial test data
 */
async function seedDatabase() {
  logger.info('Seeding database with test data...');
  
  try {
    // Hash the password properly with bcrypt
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(TEST_USER_PASSWORD, salt);
    
    // Create test user with fixed credentials
    const testUser = await prisma.user.create({
      data: {
        id: TEST_USER_ID,
        email: TEST_USER_EMAIL,
        passwordHash: passwordHash, // Properly hashed password
        firstName: 'Test',
        lastName: 'User'
      }
    });
    
    logger.info(`Test user created: ${testUser.id} (${testUser.email})`);
    logger.info(`Use these credentials to log in:`);
    logger.info(`Email: ${TEST_USER_EMAIL}`);
    logger.info(`Password: ${TEST_USER_PASSWORD}`);
    
    // Seed some initial chat history - Need to check if chatMessage model exists
    // Commenting out as chatMessage is not in the Prisma model list
    /*
    const initialMessages = [
      {
        role: 'user',
        content: 'Hello! I\'m just setting up some tests.',
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        createdAt: new Date(Date.now() - 3600000) // 1 hour ago
      },
      {
        role: 'assistant',
        content: 'Hi there! I\'m Dot, your AI companion. I\'m ready to help with your tests.',
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        createdAt: new Date(Date.now() - 3590000) // 59:50 minutes ago
      }
    ];
    
    for (const message of initialMessages) {
      await prisma.chatMessage.create({
        data: message
      });
    }
    */
    
    // Seed some example raw data
    const sampleRawData = [
      {
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        perspectiveOwnerId: TEST_USER_ID,
        content: 'I enjoy hiking in the mountains when I have free time. Being in nature helps me relax and clear my mind.',
        contentType: 'user_chat',
        importanceScore: 0.7,
        processingStatus: 'processed',
        createdAt: new Date(Date.now() - 3500000) // 58:20 minutes ago
      },
      {
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        perspectiveOwnerId: TEST_USER_ID,
        content: 'I\'ve been working on a machine learning project that uses computer vision to identify different species of birds.',
        contentType: 'user_chat',
        importanceScore: 0.8,
        processingStatus: 'processed',
        createdAt: new Date(Date.now() - 3400000) // 56:40 minutes ago
      }
    ];
    
    for (const data of sampleRawData) {
      await prisma.rawData.create({
        data: data
      });
    }
    
    logger.info('Database seeding complete');
  } catch (error) {
    console.error('Detailed error:', error);
    logger.error('Error seeding database:', { error });
    throw error;
  }
}

/**
 * Main function to run the reset and seed process
 */
async function main() {
  try {
    // Ask for confirmation in production environments
    if (process.env.NODE_ENV === 'production') {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        rl.question('⚠️ WARNING: You are about to reset a PRODUCTION database. Are you sure? (type "yes" to confirm): ', resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'yes') {
        logger.info('Database reset cancelled');
        return;
      }
    }
    
    await resetDatabase();
    await seedDatabase();
    
    logger.info('Database reset and seed process completed successfully');
  } catch (error) {
    console.error('Main function detailed error:', error);
    logger.error('Error during database reset and seed process:', { error });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

module.exports = { resetDatabase, seedDatabase, main };
