const { prisma } = require('../db/prisma');
const logger = require('../utils/logger').childLogger('RawDataRepository');

/**
 * Creates a new raw data record.
 * @param {object} data - Data for the new record (content, contentType, userId, etc.)
 * @returns {Promise<object>} The created raw data record.
 */
const create = async (data) => {
  try {
    // Note: Importance score logic and perspective/subject ID logic should ideally live in the service layer,
    // but for initial abstraction, we replicate the logic from the controller temporarily.
    // This will be revisited in Phase 2.
    const perspectiveOwnerId = data.perspectiveOwnerId === 'system'
      ? data.userId
      : data.perspectiveOwnerId;
    const subjectId = data.subjectId || perspectiveOwnerId;
    
    // Determine appropriate importance score based on content type
    let importanceScore = data.importanceScore;
    
    // If importanceScore is null, it will be evaluated by memoryManager later
    // If undefined, use appropriate default based on contentType
    if (importanceScore === undefined) {
      const memoryConfig = require('../../config/memory.config');
      
      if (data.contentType === 'uploaded_file_event') {
        importanceScore = memoryConfig.defaultFileUploadEventImportance;
      } else if (data.contentType === 'uploaded_document_content') {
        importanceScore = memoryConfig.defaultDocumentContentImportance;
      } else {
        importanceScore = memoryConfig.defaultRawDataImportance;
      }
    }

    // Default values (can be overridden by incoming data)
    const defaults = {
      perspectiveOwnerId,
      subjectId,
      processingStatus: 'pending', // Default status
    };

    const record = await prisma.rawData.create({
      data: {
        ...defaults,
        ...data, // Incoming data overrides defaults
        importanceScore: importanceScore, // Use calculated/defaulted importance
      },
    });
    return record;
  } catch (error) {
    logger.error(`Error creating raw data: ${error.message}`, { stack: error.stack, data });
    // Re-throw specifically for database errors if needed, or a generic repo error
    throw new Error(`Database error creating raw data: ${error.message}`);
  }
};

/**
 * Finds multiple raw data records based on criteria.
 * @param {object} where - Prisma where clause.
 * @param {object} orderBy - Prisma orderBy clause.
 * @param {number} take - Prisma take clause (limit).
 * @returns {Promise<Array<object>>} Array of found raw data records.
 */
const findMany = async ({ where, orderBy, take }) => {
  try {
    const records = await prisma.rawData.findMany({
      where,
      orderBy,
      take,
    });
    return records;
  } catch (error) {
    logger.error(`Error finding raw data: ${error.message}`, { stack: error.stack, where });
    throw new Error(`Database error finding raw data: ${error.message}`);
  }
};

/**
 * Updates a raw data record.
 * @param {string} id - ID of the record to update.
 * @param {object} data - Data to update.
 * @returns {Promise<object>} The updated raw data record.
 */
const update = async (id, data) => {
  try {
    const record = await prisma.rawData.update({
      where: { id },
      data,
    });
    return record;
  } catch (error) {
    logger.error(`Error updating raw data ${id}: ${error.message}`, { stack: error.stack, data });
    throw new Error(`Database error updating raw data: ${error.message}`);
  }
};

module.exports = {
  create,
  findMany,
  update,
}; 