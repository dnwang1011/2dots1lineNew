// prisma/seed.js
// Seed database with initial data for development/testing

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');
  
  // Create test user if it doesn't exist
  const testEmail = 'test@example.com';
  const existingUser = await prisma.user.findUnique({
    where: { email: testEmail }
  });
  
  if (!existingUser) {
    // Hash password for test user
    const passwordHash = await bcrypt.hash('password123', 10);
    
    // Create test user
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        firstName: 'Test',
        lastName: 'User',
        passwordHash
      }
    });
    
    console.log(`Created test user with ID: ${user.id}`);
  } else {
    console.log(`Test user already exists with ID: ${existingUser.id}`);
  }
  
  // Initialize ontology version if it doesn't exist
  let activeVersion = await prisma.ontologyVersion.findFirst({
    where: { active: true }
  });
  
  if (!activeVersion) {
    activeVersion = await prisma.ontologyVersion.create({
      data: {
        name: 'Seed Ontology',
        description: 'Initial ontology schema created by seed script',
        active: true
      }
    });
    
    console.log(`Created ontology version with ID: ${activeVersion.id}`);
    
    // Basic node types with the same structure as in db-init.js
    const nodeTypes = [
      {
        name: 'Person',
        description: 'User, child, parent, teacher...',
        properties: JSON.stringify({
          required: ['name'],
          optional: ['age', 'gender', 'relationship']
        }),
        synonyms: ['individual', 'human', 'user'],
        ontologyVersionId: activeVersion.id
      },
      {
        name: 'Event',
        description: 'Any activity or occurrence',
        properties: JSON.stringify({
          required: ['name'],
          optional: ['date', 'location', 'description']
        }),
        synonyms: ['activity', 'occurrence', 'happening'],
        ontologyVersionId: activeVersion.id
      },
      {
        name: 'Emotion',
        description: 'Feelings experienced during events',
        properties: JSON.stringify({
          required: ['name'],
          optional: ['intensity', 'valence']
        }),
        synonyms: ['feeling', 'mood', 'sentiment'],
        ontologyVersionId: activeVersion.id
      }
    ];
    
    // Create node types
    for (const nodeType of nodeTypes) {
      await prisma.nodeType.create({ data: nodeType });
    }
    
    console.log('Created basic node types');
  } else {
    console.log(`Ontology version already exists: ${activeVersion.name}`);
  }
  
  console.log('Database seeding completed');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 