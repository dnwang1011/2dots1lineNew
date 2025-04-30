/**
 * Validates the presence of an API key in environment variables.
 * @param {string | undefined} key - The API key value from process.env.
 * @param {string} serviceName - The name of the service requiring the key (for error messages).
 * @throws {Error} If the key is not defined.
 */
function validateApiKey(key, serviceName) {
  if (!key) {
    const errorMessage = `FATAL ERROR: ${serviceName} API key is not defined in environment variables.`;
    console.error(errorMessage); // Log error before throwing
    throw new Error(errorMessage);
  }
  console.log(`${serviceName} API key found.`); // Simple confirmation log
}

module.exports = {
  validateApiKey,
}; 