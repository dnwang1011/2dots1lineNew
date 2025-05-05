// backup-system.js
// Script to backup database and Weaviate data

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const weaviateClientUtil = require('../../src/utils/weaviateClient');
const { PrismaClient } = require('@prisma/client');

async function backupSystem() {
  console.log('========================================');
  console.log('SYSTEM BACKUP');
  console.log('========================================');
  console.log(`Backup date: ${new Date().toISOString()}`);
  
  const backupDir = path.join(__dirname, '../../data/backups');
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const backupFolder = path.join(backupDir, `backup-${timestamp}`);
  
  try {
    // Create backup directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Create backup folder
    fs.mkdirSync(backupFolder, { recursive: true });
    
    // Backup Weaviate data
    await backupWeaviate(backupFolder);
    
    // Backup database
    await backupDatabase(backupFolder);
    
    console.log(`Backup completed successfully at: ${backupFolder}`);
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
  }
}

async function backupWeaviate(backupFolder) {
  console.log('\n--- WEAVIATE BACKUP ---');
  
  try {
    const client = weaviateClientUtil.getClient();
    if (!client) {
      throw new Error('Weaviate client not available');
    }
    
    // Get all classes in Weaviate
    const schemaResponse = await client.schema.getter().do();
    const classes = schemaResponse.classes || [];
    
    for (const classObj of classes) {
      const className = classObj.class;
      console.log(`Backing up class: ${className}`);
      
      // Get all objects of this class
      const result = await client.graphql
        .get()
        .withClassName(className)
        .withLimit(10000) // Adjust as needed
        .do();
      
      // Write to file
      const outputFile = path.join(backupFolder, `${className.toLowerCase()}_data.json`);
      fs.writeFileSync(outputFile, JSON.stringify(result.data.Get[className], null, 2));
      
      console.log(`  - Saved ${result.data.Get[className].length} objects to ${outputFile}`);
    }
    
    console.log('Weaviate backup completed successfully');
  } catch (error) {
    console.error(`Weaviate backup failed: ${error.message}`);
    throw error;
  }
}

async function backupDatabase(backupFolder) {
  console.log('\n--- DATABASE BACKUP ---');
  
  try {
    const prisma = new PrismaClient();
    
    // Get list of models from Prisma
    const models = Object.keys(prisma).filter(key => 
      !key.startsWith('_') && 
      typeof prisma[key] === 'object' && 
      prisma[key] !== null &&
      typeof prisma[key].findMany === 'function'
    );
    
    for (const model of models) {
      console.log(`Backing up model: ${model}`);
      
      // Get all records for this model
      const data = await prisma[model].findMany();
      
      // Write to file
      const outputFile = path.join(backupFolder, `${model.toLowerCase()}_data.json`);
      fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
      
      console.log(`  - Saved ${data.length} records to ${outputFile}`);
    }
    
    await prisma.$disconnect();
    console.log('Database backup completed successfully');
  } catch (error) {
    console.error(`Database backup failed: ${error.message}`);
    throw error;
  }
}

// Run backup if executed directly
if (require.main === module) {
  backupSystem()
    .then(() => console.log('Backup process completed'))
    .catch(err => console.error('Backup process failed:', err));
}

module.exports = { backupSystem }; 