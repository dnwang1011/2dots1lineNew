// fix-memory-manager-db.js
// Script to fix the database client issue in the memory manager

const fs = require('fs');
const path = require('path');
const memoryManagerPath = path.join(__dirname, 'src', 'services', 'memoryManager.service.js');

async function fixMemoryManagerDb() {
  console.log('========================================');
  console.log('FIX MEMORY MANAGER DB ACCESS');
  console.log('========================================');
  
  try {
    // Check if the file exists
    if (!fs.existsSync(memoryManagerPath)) {
      console.error(`Memory manager file not found at ${memoryManagerPath}`);
      return;
    }
    
    console.log(`Found memory manager at ${memoryManagerPath}`);
    
    // Read the file content
    const fileContent = fs.readFileSync(memoryManagerPath, 'utf8');
    
    // 1. Add import for PrismaClient at the top
    let updatedContent = fileContent;
    
    // Find the appropriate location for the import
    const importSection = "// Service for managing the memory processing pipeline";
    const importSectionIndex = updatedContent.indexOf(importSection);
    
    if (importSectionIndex === -1) {
      console.error('Could not find import section in the file.');
      return;
    }
    
    // Add import after the section comment
    const importEndIndex = importSectionIndex + importSection.length;
    const importToAdd = "\n\n// Import PrismaClient for memory retrieval\nconst { PrismaClient } = require('@prisma/client');\nconst prisma = new PrismaClient();\n";
    
    updatedContent = 
      updatedContent.substring(0, importEndIndex) + 
      importToAdd + 
      updatedContent.substring(importEndIndex);
    
    // Now update the file
    console.log('Writing updated file...');
    fs.writeFileSync(memoryManagerPath, updatedContent, 'utf8');
    
    console.log('✅ Successfully updated memoryManager.service.js with proper database access!');
    console.log('The memory retrieval should now work properly with database queries.');
    
    // Check for chat.service.js syntax error
    const chatServicePath = path.join(__dirname, 'src', 'services', 'chat.service.js');
    
    if (fs.existsSync(chatServicePath)) {
      console.log('\nChecking chat.service.js for syntax errors...');
      const chatServiceContent = fs.readFileSync(chatServicePath, 'utf8');
      
      // Look for the specific line with the error
      const errorLine = "memoryContext += '\\n\\nIMPORTANT: These memories contain real past conversations and experiences. Use them naturally in your response. When the user refers to past events, respond based on these memories rather than making things up or claiming you don't remember.';";
      
      if (chatServiceContent.includes(errorLine)) {
        console.log('Found potential syntax error in chat.service.js');
        
        // Replace the problematic line with a fixed version
        const fixedLine = "        memoryContext += '\\n\\nIMPORTANT: These memories contain real past conversations and experiences. Use them naturally in your response. When the user refers to past events, respond based on these memories rather than making things up or claiming you do not remember.';"
        
        const fixedContent = chatServiceContent.replace(errorLine, fixedLine);
        
        // Write the fixed content
        fs.writeFileSync(chatServicePath, fixedContent, 'utf8');
        console.log('✅ Fixed syntax error in chat.service.js');
      } else {
        console.log('No specific syntax error found in chat.service.js. Manual inspection may be needed.');
      }
    }
    
  } catch (error) {
    console.error('Error fixing memory manager database access:', error);
  }
}

// Run the fix
fixMemoryManagerDb(); 