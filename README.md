# 2dots1line

An AI companion app that provides empathetic conversation and memory management.

## Features

- Conversational AI using advanced language models
- Memory management for contextual conversations
- File upload and analysis (documents and images)
- User authentication and session management
- Vector database integration for semantic search

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: PostgreSQL with Prisma ORM
- **Vector Database**: Weaviate
- **AI Integration**: OpenAI API
- **Authentication**: JWT

## Getting Started

### Prerequisites

- Node.js (v16+)
- PostgreSQL
- Weaviate (optional for vector search)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/dnwang1011/2dots1lineNew.git
   cd 2dots1lineNew
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   # Server
   PORT=3000
   NODE_ENV=development

   # Database
   DATABASE_URL="postgresql://username:password@localhost:5432/mydatabase"

   # Authentication
   JWT_SECRET=your_jwt_secret
   JWT_EXPIRES_IN=90d

   # AI Service
   OPENAI_API_KEY=your_openai_api_key

   # Weaviate
   WEAVIATE_URL=http://localhost:8080
   WEAVIATE_API_KEY=your_weaviate_api_key
   ```

4. Setup the database:
   ```
   npx prisma migrate dev
   ```

5. Start the development server:
   ```
   npm run dev
   ```

## License

[MIT](LICENSE) 