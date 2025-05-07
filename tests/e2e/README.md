# End-to-End Testing for Dot AI

This directory contains tools and scenarios for comprehensive end-to-end testing of the Dot AI system, focusing particularly on the data and memory pipeline. These tests allow product managers, developers, and QA engineers to evaluate the system's performance through realistic user interactions rather than just automated testing.

## Directory Structure

```
tests/e2e/
├── chat_scenarios/     # Text files with pre-written chat scenarios
├── fixtures/           # Sample documents and images for multimedia tests
├── reports/            # Generated test reports (created during test runs)
├── scripts/            # Test automation scripts
└── README.md           # This file
```

## Quick Start

1. **Reset and seed the database:**
   ```
   node tests/e2e/scripts/reset_and_seed.js
   ```

2. **Run the full test suite:**
   ```
   node tests/e2e/scripts/test_runner.js
   ```

3. **Follow the prompts to conduct chat tests and analyze results.**

## Test Scenarios

The `chat_scenarios/` directory contains text files with pre-written conversation flows designed to test specific aspects of the memory pipeline:

- **basic_chat_flow.txt**: Tests core conversational memory and recall
- **episodic_memory_test.txt**: Tests formation of episodic memories from related content
- **episodic_advanced_test.txt**: Tests more advanced episodic memory, including the formation of multiple distinct episodes from different topics, and the linking of a single chunk to multiple relevant episodes.
- **thought_formation_test.txt**: Tests generation of higher-level thoughts from multiple episodes
- **importance_evaluation_test.txt**: Tests the system's ability to prioritize important information
- **multimedia_test.txt**: Tests handling of images and documents
- **extreme_edge_cases.txt**: Stress tests with challenging scenarios

## Test Artifacts

### Sample Files

The `fixtures/` directory contains sample documents for multimedia testing:
- `sample_resume.txt`: A fictional resume to test document processing
- `sample_research_paper.txt`: A research paper abstract to test scientific content processing

For image testing, you should prepare and add your own sample images:
- A personal photo (e.g., someone at a beach, hiking, etc.)
- A business chart or graph
- A scenic landscape

### Reports

Test reports are automatically generated in the `reports/` directory after running the test suite. These include:
- Memory pipeline analysis (counts of raw data, chunks, episodes, thoughts)
- Processing status statistics
- Vector embedding verification

## Detailed Testing Process

### 1. Preparation

Before running tests, ensure your development environment is properly set up:
- The API server is running
- The database is accessible
- Weaviate is running (for vector embeddings)
- Redis is running (for message queues)

### 2. Database Reset and Seeding

The `reset_and_seed.js` script:
- Removes existing test data for the test user
- Creates a clean test user
- Seeds initial messages to establish a baseline conversation

### 3. Interactive Testing

The `test_runner.js` script:
- Guides you through the testing process
- Prompts you to run test scenarios in the chat UI
- Analyzes results after you complete the scenarios

### 4. Analysis

After completing the test scenarios, the system will:
- Count entities created in the database
- Analyze processing status and importance scores
- Verify vector embeddings in Weaviate
- Generate a comprehensive report

## Testing Tips

1. **Database Isolation**: These tests use a dedicated test user ID to avoid affecting production data. The default is `e2e-test-user`.

2. **Conversation Flow**: For most realistic results, paste one message at a time into the chat UI and wait for Dot's response before continuing.

3. **Multimedia Testing**: Have the sample images and documents ready before beginning this test scenario.

4. **Manual Verification**: While the automated analysis provides metrics, manually review Dot's responses to assess quality and coherence.

5. **Extending Tests**: Create additional test scenarios in the `chat_scenarios/` directory following the same format.

## Customization

You can customize the test environment by setting these environment variables:
- `TEST_USER_ID`: Custom ID for the test user (default: 'e2e-test-user')
- `TEST_SESSION_ID`: Custom session ID (default: 'e2e-test-session')
- `NODE_ENV`: Set to 'production' to enable safety confirmations for DB operations

## Troubleshooting

If tests fail to run properly:

1. **Database Connectivity**: Ensure your database connection is active and credentials are correct.

2. **Dependencies**: Make sure all dependencies are installed (`npm install`).

3. **Permissions**: Verify the test user has appropriate database permissions.

4. **Logs**: Check API server logs for errors during test execution.

5. **Timeout Issues**: For long test scenarios, increase any relevant timeout settings in your environment. 