Consolidated Technical Feedback

(v 2025-04-30 review of latest commit + runtime log)

0. Executive Summary

The pipeline now creates the three v2 vector classes and imports new vectors, but read-time and write-time code still reference legacy field names and classes, so semantic search fails.  In addition, a missing dependency, duplicate Prisma clients, and unresolved property mismatches remain.  The list below groups every gap by area and ends with a single, ordered action checklist.

⸻

1. Vector-schema mismatches

Layer	Problem	Evidence
EpisodeEmbedding	Query asks for narrative, occurredAt, createdAt but class only has dbId, title, userId.	Log lines Cannot query field "narrative" etc.
ChunkEmbedding	Query asks for dataType, metadata, createdAt.  Class has text, rawDataId, importance, userId.	Log lines Cannot query field "dataType" etc.
ThoughtEmbedding	Query asks for id, description, createdAt.  Class has dbId, name, userId.	Log lines Cannot query field "id" etc.
Write-path	generateAndStoreEmbeddings() still sets content, dataType, metadata rather than text, drops the new dbId.	memoryManager.service.js](file-service://file-215U69kpBwMYzzj5n5unuH)
batchImportToWeaviate default	Still defaults to 'Memory', so calls that omit the arg will write to obsolete class.	memoryManager.service.js](file-service://file-215U69kpBwMYzzj5n5unuH)



⸻

2. Retrieval-pipeline gaps
	•	retrieveMemories() still targets the Memory class, then manual “Stage 1-3” searches that contain the wrong fields above.  (Code unchanged.)  memoryManager.service.js](file-service://file-4Jfr3kK1brZii43NZEh7Vt)
	•	Certainty filters and where clauses reference importance, userId correctly, but any mis-named property aborts the whole GraphQL call.

⸻

3. Prisma client leakage
	•	Log shows “Initializing new PrismaClient instance” even after adding the singleton ⇒ some service paths still call new PrismaClient() instead of the shared module.
	•	Agents do not call prisma.$disconnect() inside their new shutdown() helpers, so leaked handles will persist on hot reloads.

⸻

4. Missing / mis-pinned dependencies
	•	episodeAgent requires compute-cosine-similarity → runtime error.  Package is not in package.json.
	•	Up-stream agents assume Redis config, but redisConfig.js only validates presence; env vars missing will crash on boot.

⸻

5. Other functional gaps

Area	Issue
Cosine similarity	Even after installing the lib, EpisodeAgent should fall back to Prisma aggregate if the vector length ≠ 768.
Old vectors	Existing Memory vectors are still queried but never re-indexed into ChunkEmbedding.  Without a back-fill you lose history the moment Memory is dropped.
Log spam	5-minute Weaviate health pings flood logs.  Set log-level to debug for health or silence when status unchanged.
HNSW config drift	New classes created with default efConstruction 128, but retrieval uses certainty thresholds tuned for the old config.  Review after back-fill.



⸻

6. Action Checklist (ordered, one verb each)
	1.	Rename content→text and add dbId in every Weaviate payload (chunks, episodes, thoughts).
	2.	Change batchImportToWeaviate default class to 'ChunkEmbedding' or pass explicit class names at every call.
	3.	Modify all GraphQL queries in retrieveMemories() and the “Stage 1-3” blocks:
	•	EpisodeEmbedding → fields dbId, title, _additional { certainty }
	•	ChunkEmbedding → fields dbId, text, rawDataId, importance, userId, _additional
	•	ThoughtEmbedding → fields dbId, name, userId, _additional
	4.	Update retrieveMemories() initial .withClassName('Memory') → 'ChunkEmbedding'.
	5.	Refactor remaining new PrismaClient() occurrences to import the prisma singleton; delete the “Initializing new PrismaClient instance” message.
	6.	Install compute-cosine-similarity (npm i compute-cosine-similarity) and import it in episodeAgent.js.
	7.	Add prisma.$disconnect() inside the singleton’s shutdown() and ensure index.js awaits every agent’s shutdown().
	8.	Back-fill: write a one-off script that reads every object from class Memory, maps fields to the new ChunkEmbedding schema, and re-imports with the same vector.
	9.	Remove the Memory class only after steps 1-8 pass CI.
	10.	Tune HNSW search params (ef, certainty) after the back-fill to restore recall/precision.
	11.	Downgrade Weaviate health-check logs to debug to cut noise.
	12.	Document new property names and class responsibilities in MEMORY-MIGRATION.md to avoid future drift.
	13.	Add an end-to-end Jest test: chat ➜ chunk ➜ vector import ➜ retrieval ➜ assert ≥ 1 result.

Implementing the list above will close every log error observed in the latest run and complete the v2 memory-layer migration.  Ping me after step 4 if any query is still rejected—I’ll help adjust field sets.

	•	Schema / query-field mismatch (still outstanding)
	•	EpisodeEmbedding search is still requesting the legacy fields narrative, occurredAt, createdAt, but the new class only exposes dbId, title, userId.
	•	ChunkEmbedding search is still requesting dataType, metadata, createdAt, which no longer exist (current fields are dbId, text, rawDataId, importance, userId).
	•	ThoughtEmbedding search is still requesting id, description, createdAt, but the new shape is dbId, name, userId.
	•	➜ Action → Update every GraphQL .withFields() clause in retrieveMemories() (and any helper searches) so they request only the fields that actually exist in each new class.
	•	Missing runtime dependency in episodeAgent.js
	•	The agent calls require('compute-cosine-similarity'), which is not present in package.json or node_modules.
	•	➜ Action → npm i compute-cosine-similarity (or replace with a small inline cosine-sim function if you prefer zero-dep).
	•	Incomplete adoption of the Prisma singleton
	•	At least one path (seen when episodeAgent spins up) still executes new PrismaClient(), triggering the “Initializing new PrismaClient instance” log.
	•	Multiple clients can exhaust DB connection limits and slow shutdown.
	•	➜ Action → Search the codebase for new PrismaClient( and replace every occurrence with require('../utils/prisma').prisma (or whatever your singleton export is).
	•	Down-stream effect: memory retrieval returns zero results
	•	Because the GraphQL queries in Stage 1–3 throw schema errors, retrieveMemories() falls through and returns an empty array. No personalization context is available to Dot.
	•	➜ Action → After fixing the field mismatches above, validate that at least one relevant ChunkEmbedding is returned for a trivial query (e.g., “hello”) and that certainty filtering works.

(The earlier 422 “’id’ is a reserved property name” error is already resolved by renaming the property to dbId, so it is omitted from this list.)