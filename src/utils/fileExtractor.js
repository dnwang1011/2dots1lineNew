// src/utils/fileExtractor.js
// Utility functions for extracting text content from various file types.

const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const logger = require('./logger').childLogger('FileExtractor');
const aiConfig = require('../../config/ai.config'); // Needed for supported image extensions

/**
 * Extracts text content from a file based on its extension.
 * Note: For images, it currently returns null text, indicating it's an image.
 * 
 * @param {string} filePath - The absolute path to the file.
 * @returns {Promise<{text: string|null, error: string|null, isImage: boolean}>} 
 *          - text: Extracted text content, or null if image or error.
 *          - error: Error message if extraction failed or type unsupported.
 *          - isImage: Boolean indicating if the file is identified as a supported image type.
 */
async function extractTextFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      logger.error(`File not found for extraction: ${filePath}`);
      return { text: null, error: 'File not found.', isImage: false };
    }

    const ext = path.extname(filePath).toLowerCase();
    const isImageFile = aiConfig.supportedImageExtensions.includes(ext);

    let content = null;
    let error = null;

    if (isImageFile) {
      // No text extraction for images, just identify them.
      return { text: null, error: null, isImage: true };
    } else if (ext === '.pdf') {
      logger.debug(`Extracting text from PDF: ${filePath}`);
      const dataBuffer = await fs.promises.readFile(filePath);
      const pdfData = await pdf(dataBuffer);
      content = pdfData.text || '';
      logger.debug(`Extracted ${content.length} characters from PDF.`);
    } else if (ext === '.docx') {
       logger.debug(`Extracting text from DOCX: ${filePath}`);
      const dataBuffer = await fs.promises.readFile(filePath);
      // Use buffer directly with mammoth
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      content = result.value || '';
       logger.debug(`Extracted ${content.length} characters from DOCX.`);
    } else if (ext === '.txt' || ext === '.md') {
       logger.debug(`Reading text from TXT/MD: ${filePath}`);
      content = await fs.promises.readFile(filePath, 'utf8');
       logger.debug(`Read ${content.length} characters from TXT/MD.`);
    } else {
      logger.warn(`Unsupported file type for text extraction: ${ext} at ${filePath}`);
      error = `Unsupported file type for text extraction: ${ext}`;
    }

    return { text: content, error: error, isImage: false };

  } catch (err) {
    logger.error(`Error extracting text from file ${filePath}: ${err.message}`, { stack: err.stack });
    // Return a generic error message to the caller
    return { text: null, error: `Error processing file: ${err.message}`, isImage: false };
  }
}

module.exports = {
  extractTextFromFile,
}; 