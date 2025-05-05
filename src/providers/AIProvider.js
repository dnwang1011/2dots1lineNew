/**
 * Abstract base class (or conceptual interface) for AI Providers.
 * Defines the common methods that concrete providers must implement.
 */
class AIProvider {
  constructor() {
    if (this.constructor === AIProvider) {
      throw new Error("Abstract classes can't be instantiated.");
    }
  }

  /**
   * Initializes the provider (e.g., connects to the API).
   * @abstract
   */
  async initialize() {
    throw new Error('Method \'initialize()\' must be implemented.');
  }

  /**
   * Sends a chat message and gets a response, handling history and context.
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @param {string} message - User message
   * @param {object} [options] - Additional options (e.g., { additionalContext: string })
   * @returns {Promise<object>} - { success: boolean, text: string | null, error?: string }
   * @abstract
   */
  async sendMessage(userId, sessionId, message, options) {
    throw new Error('Method \'sendMessage()\' must be implemented.');
  }

  /**
   * Analyzes an image, potentially with accompanying text.
   * @param {object} params - Parameters (e.g., { userId, sessionId, file: { buffer, mimetype }, userMessage })
   * @returns {Promise<object>} - { success: boolean, text: string | null, error?: string }
   * @abstract
   */
  async analyzeImage(params) {
    throw new Error('Method \'analyzeImage()\' must be implemented.');
  }

  /**
   * Generates embeddings for text content.
   * @param {string | string[]} content - Text content or array of text content.
   * @returns {Promise<Array<number[]>|null>} Array of embedding vectors, or null on error.
   * @abstract
   */
  async generateEmbeddings(content) {
    throw new Error('Method \'generateEmbeddings()\' must be implemented.');
  }

  /**
   * Gets a simple text completion for a given prompt (no history).
   * @param {string} prompt - The prompt.
   * @returns {Promise<string|null>} The completed text, or null on error.
   * @abstract
   */
  async getCompletion(prompt) {
    throw new Error('Method \'getCompletion()\' must be implemented.');
  }

  // Add other methods as needed (e.g., specific model interactions)
}

module.exports = AIProvider; 