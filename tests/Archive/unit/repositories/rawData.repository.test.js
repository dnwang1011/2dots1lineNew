const rawDataRepository = require('../../src/repositories/rawData.repository');
const { prisma } = require('../../src/db/prisma');

// Mock the Prisma client
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    rawData: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock the config require
jest.mock('../../config/memory.config', () => ({
  defaultRawDataImportance: 0.5,
}));

describe('RawData Repository', () => {
  afterEach(() => {
    // Clear mock calls after each test
    jest.clearAllMocks();
  });

  it('should create raw data record', async () => {
    const inputData = {
      content: 'Test content',
      contentType: 'user_chat',
      userId: 'user1',
      sessionId: 'session1',
      perspectiveOwnerId: 'user1',
    };
    const expectedRecord = { ...inputData, id: 'record1', importanceScore: 0.5, processingStatus: 'pending', skipImportanceCheck: false, subjectId: 'user1' };
    prisma.rawData.create.mockResolvedValue(expectedRecord);

    const result = await rawDataRepository.create(inputData);

    expect(prisma.rawData.create).toHaveBeenCalledTimes(1);
    expect(prisma.rawData.create).toHaveBeenCalledWith({
      data: {
        content: 'Test content',
        contentType: 'user_chat',
        userId: 'user1',
        sessionId: 'session1',
        perspectiveOwnerId: 'user1',
        subjectId: 'user1',
        importanceScore: 0.5,
        processingStatus: 'pending',
        skipImportanceCheck: false,
      },
    });
    expect(result).toEqual(expectedRecord);
  });

   it('should find many raw data records', async () => {
      const criteria = { where: { userId: 'user1' }, orderBy: { createdAt: 'asc' }, take: 10 };
      const expectedRecords = [{ id: '1', content: 'msg1' }, { id: '2', content: 'msg2' }];
      prisma.rawData.findMany.mockResolvedValue(expectedRecords);

      const result = await rawDataRepository.findMany(criteria);

      expect(prisma.rawData.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.rawData.findMany).toHaveBeenCalledWith(criteria);
      expect(result).toEqual(expectedRecords);
    });

    it('should update a raw data record', async () => {
      const recordId = 'record1';
      const updateData = { processingStatus: 'processed' };
      const expectedRecord = { id: recordId, ...updateData };
      prisma.rawData.update.mockResolvedValue(expectedRecord);

      const result = await rawDataRepository.update(recordId, updateData);

      expect(prisma.rawData.update).toHaveBeenCalledTimes(1);
      expect(prisma.rawData.update).toHaveBeenCalledWith({ where: { id: recordId }, data: updateData });
      expect(result).toEqual(expectedRecord);
    });

   it('should handle errors during creation', async () => {
      const inputData = { content: 'Test' };
      const dbError = new Error('DB connection failed');
      prisma.rawData.create.mockRejectedValue(dbError);

      await expect(rawDataRepository.create(inputData))
        .rejects
        .toThrow('Database error creating raw data: DB connection failed');
    });

   // Add similar error handling tests for findMany and update
}); 