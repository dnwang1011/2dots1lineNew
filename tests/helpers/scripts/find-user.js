// find-user.js
// Script to find a user by first name

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findUser(firstName) {
  try {
    console.log(`Searching for user with firstName: "${firstName}"`);
    
    const user = await prisma.user.findFirst({
      where: { 
        firstName: firstName 
      }
    });
    
    if (user) {
      console.log('User found:');
      console.log(`ID: ${user.id}`);
      console.log(`Name: ${user.firstName} ${user.lastName || ''}`);
      console.log(`Email: ${user.email || 'N/A'}`);
      console.log(`Created: ${user.createdAt}`);
      return user.id;
    } else {
      console.log(`No user found with firstName: "${firstName}"`);
      return null;
    }
  } catch (error) {
    console.error(`Error finding user: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Execute with command line arg or default to 'qwe'
const firstName = process.argv[2] || 'qwe';
findUser(firstName); 