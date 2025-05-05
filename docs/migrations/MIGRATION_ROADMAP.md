# Refactoring & Technical Debt Migration Roadmap

This document outlines a practical, sequenced roadmap for addressing technical debt and implementing the best practices defined in `CODING_STANDARDS.md`. The goal is to incrementally improve the codebase's quality, maintainability, and robustness.

**Guiding Principles for Sequencing:**

*   **Foundations First:** Establish necessary tools and configurations early.
*   **Enable Safe Refactoring:** Implement testing infrastructure before major changes.
*   **Address Dependencies:** Tackle foundational abstractions (DAL, AI Provider) before refactoring dependent services.
*   **Incremental Changes:** Break down large refactoring efforts into smaller, manageable steps.
*   **Balance Effort & Impact:** Incorporate some "low-hanging fruit" alongside more significant architectural work.

---

**Phase 0: Setup & Foundations (Low Effort, High Enabling Value)**

*   **Goal:** Prepare the development environment for consistent quality and safer refactoring.
*   **Steps:**
    1.  **Setup Linters & Formatters:**
        *   Implement ESLint and Prettier with agreed-upon configurations.
        *   Integrate into CI/CD pipeline to enforce standards on new code.
        *   *(Low Hanging Fruit: Quick win for consistency)*
    2.  **Establish Basic Testing Framework:**
        *   Choose and configure a testing framework (e.g., Jest).
        *   Set up basic test running scripts.
        *   *(Essential prerequisite for safe refactoring)*
    3.  **Externalize Configuration:**
        *   Identify all hardcoded values (API keys, thresholds, prompts, model names).
        *   Move secrets and environment-specific values to `.env` (using `dotenv`).
        *   Move non-secret parameters to structured configuration files (`/config`).
        *   Implement centralized loading/validation of configuration at startup.
        *   *(Relatively Low Effort, High Impact for maintainability & security)*
    4.  **Centralized Logging Setup:**
        *   Ensure a consistent logger instance is used throughout the backend.
        *   Establish basic structured logging format (including context like `userId`, `sessionId`).

**Phase 1: Core Abstractions & Unit Testing (Medium Effort, High Architectural Value)**

*   **Goal:** Create foundational abstractions for database access and AI provider interaction, enabling cleaner service logic. Start building the unit testing safety net.
*   **Steps:**
    1.  **Implement Repository Pattern / DAL:**
        *   Create repository modules (e.g., `rawData.repository.js`, `chunk.repository.js`) for core data models.
        *   Encapsulate all Prisma queries within these repositories.
        *   Refactor *direct* Prisma calls in services/controllers to use repositories (start with a few key ones).
        *   **Write Unit Tests:** Create unit tests for the new repository methods, mocking Prisma.
    2.  **Abstract AI Provider:**
        *   Define an `AIProvider` interface (or abstract class).
        *   Create a `GeminiProvider` implementation that conforms to the interface and handles Gemini-specific API calls.
        *   Refactor `ai.service.js` to use the `AIProvider` interface via dependency injection or a factory.
        *   **Write Unit Tests:** Create unit tests for the `GeminiProvider` (mocking external HTTP calls) and for parts of `ai.service` that use the interface (mocking the provider).

**Phase 2: Service Layer Refactoring & Integration Testing (High Effort, High Impact)**

*   **Goal:** Refactor core services and controllers to align with SoC principles and utilize the new abstractions. Expand test coverage to integration points.
*   **Steps:**
    1.  **Refactor `ai.service.js`:**
        *   Break down into smaller, task-specific functions/modules (chat, image, doc, importance, embedding) using the `AIProvider` interface.
        *   Move prompt templating logic to configuration or dedicated helpers.
        *   **Write/Expand Tests:** Add unit tests for new modules and integration tests for key AI flows (mocking the provider interface).
    2.  **Refactor `memoryManager.service.js`:**
        *   Ensure focus on memory CRUD and retrieval logic.
        *   Delegate embedding generation to `ai.service`.
        *   Use repositories for all database access.
        *   Refactor complex methods (`retrieveMemories`, `processRawData`) into smaller units.
        *   **Write/Expand Tests:** Unit tests for logic, integration tests for interaction with repositories and `ai.service` mocks.
    3.  **Refactor Controllers (`chat.controller.js`):**
        *   Thin down controllers significantly.
        *   Introduce primary services (e.g., `chat.service.js`, `fileUpload.service.js`) if not already present.
        *   Delegate all business logic, data recording, and downstream calls to these primary services.
        *   **Write/Expand Tests:** Integration tests for controllers, mocking the primary service layer.
    4.  **Refactor `fileUpload.service.js` (or logic within `chat.controller`):**
        *   Clearly separate image vs. document handling logic.
        *   Use `ai.service` for analysis/summary.
        *   Use repositories/DAL for recording file events/content.
        *   Replace synchronous file I/O with async versions.
        *   **Write/Expand Tests:** Unit and integration tests for file handling logic.

**Phase 3: API, Background Tasks & E2E Testing (Medium Effort, High Robustness Value)**

*   **Goal:** Improve API design for long-running tasks and make background processing more robust. Validate critical user flows.
*   **Steps:**
    1.  **Decouple Long-Running API Calls (Optional but Recommended):**
        *   If feasible, refactor `/chat/upload` to return `202 Accepted` and process analysis asynchronously (using queues from step 2).
        *   Implement status polling or WebSocket updates for the client.
    2.  **Implement Robust Background Job Queues:**
        *   Replace simple async calls (`memoryManager.processRawData().catch(...)`) with a proper job queue system (e.g., BullMQ).
        *   Configure queues for memory processing, consolidation, etc., with retries, backoff, and dead-letter handling.
    3.  **Standardize API Response Structures:**
        *   Ensure consistency across endpoints (e.g., `aiResponse.text`).
    4.  **Implement End-to-End (E2E) Tests:**
        *   Set up an E2E testing framework (e.g., Supertest for API tests, potentially Playwright/Cypress if UI interaction is needed).
        *   Write E2E tests for critical flows: sending a message, uploading an image+message, uploading a document+message.

**Phase 4: Cleanup & Polish (Medium Effort, Medium Impact)**

*   **Goal:** Address remaining technical debt, refine agent interactions, and polish the codebase.
*   **Steps:**
    1.  **Remove Debugging Code:** Perform a thorough sweep to remove all remaining `console.log` and unnecessary verbose logging.
    2.  **Address Migration Remnants:** Clean up any remaining v1/v2 migration code, flags (`forceImportant`?), or database schema elements.
    3.  **Refine Agent Interactions:** Solidify communication patterns between agents (API, queues, events) based on architectural decisions.
    4.  **Review Frontend Code:** Apply similar refactoring principles (modularity, state management, configuration, error handling) to `public/js/chat.js` based on the initial review.
    5.  **Documentation:** Ensure key architectural decisions, service responsibilities, and setup procedures are documented (e.g., in README files).
    6.  **Continuous Testing:** Continue adding unit, integration, and E2E tests as needed for new features and refactored areas.

---

This roadmap provides a structured approach. Steps within phases can sometimes be parallelized, and priorities might shift based on specific business needs or discovered issues. The key is consistent, incremental improvement guided by the defined standards and backed by automated testing.  or 