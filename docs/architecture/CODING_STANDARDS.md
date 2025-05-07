# Coding Standards & Best Practices

This document outlines the coding standards, architectural principles, and best practices to be followed for all development and refactoring within this codebase. Adhering to these guidelines ensures consistency, maintainability, extensibility, and overall code quality.

## I. Architecture & Modularity

1.  **Separation of Concerns (SoC):**
    *   **Controllers:** MUST remain thin. Responsibilities are limited to: Request/Response lifecycle management, Input Validation, Authentication/Authorization checks (if applicable), Delegation to a single primary service, and Formatting the final HTTP response. Controllers SHOULD NOT contain business logic, database queries, or direct calls to multiple downstream services/agents.
    *   **Services:** Encapsulate business logic. Primary services (e.g., `ChatService`, `FileUploadService`) orchestrate workflows by calling specialized services or repositories. Specialized services (`AIService`, `MemoryManagerService`) handle specific domains. Services SHOULD NOT directly manipulate the HTTP request/response.
    *   **Repositories/DAL:** Abstract all database interactions. Services MUST interact with the database via repositories, not directly with the ORM (Prisma).
    *   **Agents:** Represent distinct functional units within the multi-agent framework (`ConsolidationAgent`, `EpisodeAgent`). They SHOULD have clearly defined responsibilities and interact via well-defined APIs, queues, or events, not complex direct calls.
    *   **Frontend:** Separate UI rendering, state management, API interactions, and utility functions into distinct modules (`ui.js`, `state.js`, `api.js`, `utils.js`). Avoid global state where possible.

2.  **Modularity & Cohesion:**
    *   Modules and services SHOULD be highly cohesive, grouping related functionality.
    *   Keep functions and methods small and focused on a single responsibility (SRP). Aim for functions < 50 lines where practical.
    *   Break down complex services (`AIService`) into smaller, task-specific modules (e.g., `chatCompletion`, `imageAnalysis`, `embeddingGenerator`).

3.  **Dependency Management:**
    *   Use dependency injection where appropriate to manage service dependencies explicitly.
    *   Minimize circular dependencies between modules/services.

4.  **API Design:**
    *   Design clear, consistent, and predictable RESTful APIs.
    *   Standardize response structures (e.g., consistent naming for fields like `aiResponse`).
    *   Decouple long-running operations from synchronous API responses (e.g., use `202 Accepted` and background processing for tasks like file analysis).

## II. Code Quality & Maintainability

5.  **Readability & Naming:**
    *   Use clear, descriptive names for variables, functions, classes, and files.
    *   Follow consistent naming conventions: `camelCase` for variables/functions, `PascalCase` for classes in JavaScript/TypeScript.
    *   Write self-documenting code. Add comments only for complex logic or to explain *why*, not *what*. Avoid obvious comments.

6.  **Code Style:**
    *   Use Prettier for automated code formatting.
    *   Use ESLint with a standard configuration (e.g., Airbnb, Standard) to enforce coding style and catch potential errors. Address all linter warnings.

7.  **DRY (Don't Repeat Yourself):**
    *   Abstract repetitive code into reusable functions, classes, or modules.

8.  **Debugging Code:**
    *   Remove all temporary debugging code (`console.log`, `console.error`, excessive `logger.debug`) before committing.

9.  **Asynchronous Code:**
    *   Standardize on `async/await` for handling promises.
    *   Avoid synchronous I/O operations in request handling paths.
    *   Ensure all promises are correctly handled (awaited or returned) and have appropriate error handling.

## III. Error Handling & Robustness

10. **Consistent Error Handling:**
    *   Use a centralized error handling mechanism (`handleServiceError` middleware).
    *   Throw specific, custom error classes (extending `Error` or `ServiceError`) to allow for granular error handling.
    *   Ensure robust error handling for background jobs (retries, dead-letter queues).
    *   Log errors effectively with sufficient context (see Logging).

11. **Resource Management:**
    *   Ensure resources (e.g., file handles, temporary files) are reliably cleaned up, potentially using `finally` blocks or dedicated middleware.

## IV. Configuration & Environment

12. **Externalize Configuration:**
    *   NO hardcoded secrets, API keys, URLs, or magic numbers in the code.
    *   Use environment variables (`.env` files loaded via `dotenv`) for secrets and environment-specific settings.
    *   Use dedicated configuration files (`/config`) for non-secret application parameters (thresholds, model names, prompt templates, feature flags).
    *   Load and validate configuration at application startup.

## V. Database Interaction

13. **Repository Pattern:**
    *   All database interactions MUST go through a dedicated Data Access Layer (DAL) or Repository modules.
    *   Repositories encapsulate ORM (Prisma) queries. Services interact with repositories, not Prisma directly.

## VI. Testing

14. **Test Coverage:**
    *   Implement a comprehensive testing strategy:
        *   **Unit Tests:** For individual functions, modules, repositories. Mock dependencies.
        *   **Integration Tests:** For interactions between services and with the database/external systems (using test doubles or test databases).
        *   **End-to-End (E2E) Tests:** For critical user flows via API endpoints.
    *   Write tests *alongside* or *before* implementing new features or refactoring existing code (TDD/BDD encouraged).
    *   Maintain reasonable test coverage and ensure tests pass before merging code.

## VII. Logging

15. **Structured & Effective Logging:**
    *   Use a dedicated logger (e.g., Winston, Pino).
    *   Log key application lifecycle events, decisions, and errors.
    *   Use appropriate log levels (`DEBUG`, `INFO`, `WARN`, `ERROR`). Avoid logging excessive data at `INFO` level.
    *   Include relevant context in logs (e.g., `userId`, `sessionId`, `requestId`, entity IDs) in a structured format (JSON).
    *   Do NOT log sensitive information (passwords, full API keys, excessive PII) unless absolutely necessary and properly secured/masked.

## VIII. File & Resource Naming Conventions

16. **Consistent Naming Patterns:**
    * Use lowercase for all filenames (HTML, CSS, JS, images) to ensure cross-platform compatibility and prevent case-sensitivity issues.
    * Use kebab-case for multi-word filenames (e.g., `user-profile.html`, `api-client.js`).
    * File extensions MUST accurately reflect the file content type (`.js`, `.html`, `.css`).
    * Server-side code MUST reference files using the exact same case and naming pattern as the actual files on disk.
    * NEVER rely on case-insensitive filesystems or symbolic links to resolve inconsistencies between code references and actual filenames.

17. **Resource Organization:**
    * Frontend assets should be organized in semantic directories:
      * `/css` - Style sheets
      * `/js` - JavaScript files
      * `/images` - Image assets
      * `/fonts` - Font files
    * HTML templates should be in the root of the `/public` directory.
    * Each HTML file should have a clear, purpose-indicating name (e.g., `index.html`, `login.html`, `profile.html`).

## Vector Database and Memory System

### Vector Dimension Consistency

- Always verify vector dimensions match between:
  - Embedding generation (query vectors)
  - Vector database schema
  - Stored vectors
- When using multiple models, ensure dimension transformations are applied consistently
- Document required dimensions for each vector class in code comments

### Memory System Architecture

- Memory retrieval follows a multi-stage process:
  1. Search for relevant episodes first
  2. Retrieve chunks linked to episodes
  3. Search for standalone chunks
  4. Search for relevant thoughts
- Use diagnostic tools (`check-weaviate-schema.js`, `check-weaviate-episodes.js`) regularly

### Testing Memory Components

- Test vector generation separately from storage and retrieval
- Create mock embeddings for testing when needed
- Test both direct database queries and vector searches
- Verify memory context formatting renders correctly

### Monitoring Memory System

- Monitor logs for "[MemoryManager]" entries
- Track key metrics:
  - Retrieval success rate
  - Similarity scores (should typically be >70% for good matches)
  - Vector dimension transformations
  - Database query performance
- Run regular integrity checks on the vector database

### Troubleshooting Memory Issues

- Check vector dimensions first
- Verify database access is working
- Test direct Weaviate queries separate from application logic
- Examine sample vectors for unexpected patterns or values
- Check for proper normalization of vectors

By adhering to these standards, we aim to build a robust, maintainable, and high-quality application. 