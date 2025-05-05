const { prisma } = require('../db/prisma');
const logger = require('../utils/logger').childLogger('ChunkRepository');

const { v4: uuidv4 } = require('uuid');
const { encode } = require('gpt-tokenizer');

/**
 * Creates a new chunk record.
 * @param {object} data - Data for the new chunk.
 * @param {string} data.rawDataId
 * @param {string} data.userId
 * @param {string} data.sessionId
 * @param {string} data.text
 * @param {number} data.index
 * @param {number} data.importanceScore
 * @param {object} data.metadata
 * @returns {Promise<object>} The created chunk record.
 */
const create = async (data) => {
  try {
    const chunkRecord = await prisma.chunkEmbedding.create({
      data: {
        id: uuidv4(), // Generate ID here
        rawDataId: data.rawDataId,
        userId: data.userId,
        sessionId: data.sessionId,
        text: data.text,
        index: data.index,
        tokenCount: encode(data.text).length, // Calculate token count
        importance: data.importanceScore,
        processingStatus: data.processingStatus || 'pending', // Default status
        metadata: data.metadata || {}, // Ensure metadata object exists
      },
    });
    return chunkRecord;
  } catch (error) {
    logger.error(`Error creating chunk embedding: ${error.message}`, { stack: error.stack, data });
    throw new Error(`Database error creating chunk embedding: ${error.message}`);
  }
};

/**
 * Updates multiple chunk records based on criteria.
 * @param {object} where - Prisma where clause.
 * @param {object} data - Data to update.
 * @returns {Promise<object>} Prisma batch payload.
 */
const updateMany = async ({ where, data }) => {
  try {
    const result = await prisma.chunkEmbedding.updateMany({
      where,
      data,
    });
    return result;
  } catch (error) {
    logger.error(`Error updating many chunk embeddings: ${error.message}`, { stack: error.stack, where });
    throw new Error(`Database error updating many chunk embeddings: ${error.message}`);
  }
};

/**
 * Finds multiple chunk records based on criteria.
 * @param {object} where - Prisma where clause.
 * @param {number} take - Prisma take clause (limit).
 * @returns {Promise<Array<object>>} Array of found chunk records.
 */
const findMany = async ({ where, take }) => {
  try {
    const records = await prisma.chunkEmbedding.findMany({
      where,
      take,
    });
    return records;
  } catch (error) {
    logger.error(`Error finding chunk embeddings: ${error.message}`, { stack: error.stack, where });
    throw new Error(`Database error finding chunk embeddings: ${error.message}`);
  }
};

// Add other necessary chunk operations as needed (e.g., findById, delete, etc.)

module.exports = {
  create,
  updateMany,
  findMany,
}; 