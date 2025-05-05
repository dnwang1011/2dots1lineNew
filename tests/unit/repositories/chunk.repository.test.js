const chunkRepository = require('../../src/repositories/chunk.repository');
const { prisma } = require('../../src/db/prisma');
const { v4: uuidv4 } = require('uuid');
const { encode } = require('gpt-tokenizer');

// Mock Prisma client
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    chunk: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

// Mock uuid
jest.mock('uuid');
// Mock gpt-tokenizer
jest.mock('gpt-tokenizer');

describe('Chunk Repository', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    // Provide default mock implementations
    uuidv4.mockReturnValue('mock-uuid');
    // Set a default mock return value for encode, tests can override if needed
    encode.mockReturnValue([]); // Default to empty array to get length 0
  });

  it('should create a chunk record', async () => {
    const inputData = {
      rawDataId: 'raw1',
      userId: 'user1',
      sessionId: 'session1',
      text: 'This is chunk text',
      index: 0,
      importanceScore: 0.7,
      metadata: { contentType: 'user_chat' },
    };
    // Mock encode specifically for this test case to return an array of expected length
    const expectedTokens = [1, 2, 3, 4]; // Example token IDs
    encode.mockReturnValue(expectedTokens);
    const expectedTokenCount = expectedTokens.length;

    const expectedRecord = {
      ...inputData,
      id: 'mock-uuid',
      tokenCount: expectedTokenCount,
      processingStatus: 'pending',
    };
    prisma.chunk.create.mockResolvedValue(expectedRecord);

    const result = await chunkRepository.create(inputData);

    expect(encode).toHaveBeenCalledWith(inputData.text);
    expect(prisma.chunk.create).toHaveBeenCalledTimes(1);
    expect(prisma.chunk.create).toHaveBeenCalledWith({
      data: {
        id: 'mock-uuid',
        rawDataId: 'raw1',
        userId: 'user1',
        sessionId: 'session1',
        text: 'This is chunk text',
        index: 0,
        tokenCount: expectedTokenCount,
        importanceScore: 0.7,
        processingStatus: 'pending',
        metadata: { contentType: 'user_chat' },
      },
    });
    expect(result).toEqual(expectedRecord);
  });

  it('should update many chunk records', async () => {
    const criteria = { where: { rawDataId: 'raw1' }, data: { processingStatus: 'processed' } };
    const expectedResult = { count: 2 }; // Prisma updateMany returns count
    prisma.chunk.updateMany.mockResolvedValue(expectedResult);

    const result = await chunkRepository.updateMany(criteria);

    expect(prisma.chunk.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.chunk.updateMany).toHaveBeenCalledWith(criteria);
    expect(result).toEqual(expectedResult);
  });

  it('should find many chunk records', async () => {
    const criteria = { where: { processingStatus: 'pending_weaviate' }, take: 5 };
    const expectedRecords = [{ id: 'chunk1' }, { id: 'chunk2' }];
    prisma.chunk.findMany.mockResolvedValue(expectedRecords);

    const result = await chunkRepository.findMany(criteria);

    expect(prisma.chunk.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.chunk.findMany).toHaveBeenCalledWith(criteria);
    expect(result).toEqual(expectedRecords);
  });

  it('should handle errors during creation', async () => {
      const inputData = { text: 'Test' };
      const dbError = new Error('DB connection failed');
      prisma.chunk.create.mockRejectedValue(dbError);

      await expect(chunkRepository.create(inputData))
        .rejects
        .toThrow('Database error creating chunk: DB connection failed');
    });

   // Add similar error handling tests for findMany and updateMany
}); 