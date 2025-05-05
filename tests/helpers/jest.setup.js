// tests/helpers/jest.setup.js
// Common setup for all Jest tests

// Set default test timeout to 10 seconds
jest.setTimeout(10000);

// Set up global test environment setup
beforeAll(async () => {
  // Global setup if needed before all tests
  console.log('Starting test suite...');
});

// Global test environment teardown
afterAll(async () => {
  // Global cleanup if needed after all tests
  console.log('Test suite complete.');
});

// Error handler to make async errors more visible in tests
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection in tests:', err);
});

// Mock console methods to reduce noise in test output if needed
// Uncomment these lines to silence console output during tests
/*
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Comment these out when debugging tests
console.log = jest.fn();
console.error = jest.fn();
console.warn = jest.fn();

// Restore console methods after tests
afterAll(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});
*/ 