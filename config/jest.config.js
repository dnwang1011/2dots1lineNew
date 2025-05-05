module.exports = {
  testEnvironment: 'node', // Specify the test environment
  verbose: true, // Display individual test results with hierarchy
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/prisma/', // Ignore Prisma generated files
    '/scripts/', // Ignore utility scripts
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
  ],
  // Common test setup for all test files
  setupFilesAfterEnv: ['./tests/helpers/jest.setup.js'],
  // Test pattern to match test files
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.integration.test.js',
    '**/tests/**/*.e2e.test.js'
  ],
  // Directory for Jest to store its cache
  cacheDirectory: '<rootDir>/.jest-cache',
  // Define test environments for different test types
  projects: [
    {
      displayName: 'unit',
      testMatch: ['**/tests/unit/**/*.test.js'],
      testEnvironment: 'node'
    },
    {
      displayName: 'integration',
      testMatch: ['**/tests/integration/**/*.integration.test.js'],
      testEnvironment: 'node'
    },
    {
      displayName: 'e2e',
      testMatch: ['**/tests/e2e/**/*.e2e.test.js'],
      testEnvironment: 'node'
    }
  ],
  // Environment configuration
  testEnvironmentOptions: {
    // Path to the test environment variables
    dotEnvPath: './tests/env/.env.test'
  }
}; 