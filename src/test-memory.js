// Test script for memory manager functionality
require('dotenv').config();

// Set environment variables for test
process.env.DEFAULT_IMPORTANCE_THRESHOLD = process.env.DEFAULT_IMPORTANCE_THRESHOLD || '0.44';
process.env.WEAVIATE_HOST = process.env.WEAVIATE_HOST || 'http://localhost:8080';

const memoryManager = require('./services/memoryManager.service');

// Test helper to create a raw data record
const createTestRawData = (content, contentType = 'user_chat') => ({
  id: `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  content,
  contentType,
  perspectiveOwnerId: '123e4567-e89b-12d3-a456-426614174000', // Mock UUID
  subjectId: '123e4567-e89b-12d3-a456-426614174000', // Same as perspective for this test
  createdAt: new Date(),
  userId: '123e4567-e89b-12d3-a456-426614174000',
  sessionId: 'test-session'
});

// Test samples with varying importance levels
const testSamples = [
  // High importance - personal, emotional, goals
  {
    content: "I'm feeling really anxious about my college application to Harvard. It's been my dream school since I was a child, and I'm worried my grades won't be good enough. My parents have high expectations and I don't want to disappoint them.",
    contentType: 'user_chat',
    expectedImportance: 'high'
  },
  
  // Medium importance - some personal content but less emotional
  {
    content: "I went to the store yesterday and bought some groceries. I'm planning to cook a special dinner next week when my friend visits.",
    contentType: 'user_chat',
    expectedImportance: 'medium'
  },
  
  // Low importance - casual, no personal significance
  {
    content: "What's the weather like today?",
    contentType: 'user_chat',
    expectedImportance: 'low'
  },
  
  // Long content for testing chunking
  {
    content: `
      Let me tell you about my life journey so far. I was born in a small town in Ohio to immigrant parents who worked incredibly hard to give me opportunities they never had. Growing up, I was always drawn to science and would spend hours conducting small experiments in our backyard. My father, who worked as a factory technician, would bring home broken appliances for me to take apart and try to fix.
      
      In high school, I excelled in mathematics and physics, but struggled with English literature. My teacher, Mrs. Johnson, spent extra time after school helping me understand Shakespeare and improve my writing skills. Her dedication inspired me to work harder, and by senior year I was getting A's in all my classes.
      
      The college application process was stressful. I applied to twelve schools, hoping to get into at least one with a good engineering program. When I got my acceptance letter from MIT, my whole family celebrated. It was a defining moment in my life.
      
      College was challenging but rewarding. I double majored in Mechanical Engineering and Computer Science, often staying up until 3 AM to finish projects and assignments. During my sophomore year, I joined a research lab working on robotics. The professor became my mentor and encouraged me to consider graduate school.
      
      After graduating, I decided to gain industry experience before continuing my education. I worked at a tech startup for three years, developing algorithms for autonomous vehicles. The fast-paced environment taught me valuable skills in teamwork and project management.
      
      Now, I'm at a crossroads. I've been accepted to several graduate programs, but I've also received an attractive job offer from a major tech company. I'm trying to decide which path will give me the most fulfillment and allow me to make the greatest impact. I value work-life balance, but I'm also ambitious and want to push the boundaries of what's possible in my field.
    `,
    contentType: 'user_chat',
    expectedImportance: 'high',
    expectChunking: true
  },
  
  // AI response - typically lower importance than user messages
  {
    content: "I understand your concerns about college applications. Many students feel this way, and it's completely normal to be anxious about such an important decision. Would you like to talk more about your specific worries?",
    contentType: 'ai_response',
    expectedImportance: 'medium'
  }
];

// Additional test samples
testSamples.push(
  // Document content - technical
  {
    content: `# Technical Analysis of Vector Databases

Vector databases are specialized database systems designed to store, index, and query high-dimensional vector data efficiently. These systems are becoming increasingly important as embedding-based machine learning applications become more prevalent across industries.

## Key Components

1. **Vector Indexing Algorithms**: ANN (Approximate Nearest Neighbor) approaches like HNSW, IVF, and PQ compression
2. **Distance Metrics**: Cosine similarity, Euclidean distance, Dot product
3. **Storage Engine**: Optimized for vector operations and memory-efficient representation

## Popular Vector Database Systems

- **Weaviate**: Open-source vector search engine with GraphQL interface
- **Pinecone**: Cloud-native vector database with simple API
- **Milvus**: Distributed vector database system
- **Qdrant**: Vector similarity search engine

## Use Cases

Vector databases excel in:
- Semantic search
- Recommendation systems
- Image similarity
- Anomaly detection
- Natural language processing applications`,
    contentType: 'uploaded_file_event',
    expectedImportance: 'high',
    expectChunking: true
  },
  
  // Entity information
  {
    content: "Albert Einstein was a German-born theoretical physicist who developed the theory of relativity, one of the two pillars of modern physics. His work is also known for its influence on the philosophy of science.",
    contentType: 'entity_info',
    expectedImportance: 'high'
  }
);

// Run tests
async function runTests() {
  console.log('Starting Memory Manager Tests');
  console.log('=============================');
  
  for (const [index, sample] of testSamples.entries()) {
    console.log(`\nTest ${index + 1}: Processing ${sample.contentType} - Expected importance: ${sample.expectedImportance}`);
    console.log('-'.repeat(80));
    
    const rawData = createTestRawData(sample.content, sample.contentType);
    console.log(`Content preview: "${sample.content.substring(0, 50)}..."`);
    
    try {
      // Process the raw data in test mode (compatible with updated method)
      await memoryManager.processRawData(rawData, true);
      console.log(`Test ${index + 1} completed`);
    } catch (error) {
      console.error(`Test ${index + 1} failed:`, error);
    }
    
    console.log('-'.repeat(80));
  }
  
  // Test ID-based invocation
  console.log('\nTesting ID-based invocation:');
  try {
    const mockId = 'test-id-' + Date.now();
    const mockData = createTestRawData('This is a test of ID-based invocation', 'test_data');
    mockData.id = mockId;
    
    await memoryManager.processRawData(mockId, mockData);
    console.log('ID-based invocation test completed');
  } catch (error) {
    console.error('ID-based invocation test failed:', error);
  }
  
  console.log('\nAll tests completed');
}

// Run the tests
runTests().catch(err => console.error('Test error:', err)); 