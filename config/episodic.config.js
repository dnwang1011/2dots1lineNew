// config/episodic.config.js
// Configuration for episodic memory parameters (consolidation, clustering, etc.)

module.exports = {
  // Consolidation parameters
  consolidationThreshold: parseInt(process.env.CONSOLIDATION_THRESHOLD, 10) || 2, // Minimum number of orphan chunks to trigger consolidation
  orphanClusterCreationThreshold: parseFloat(process.env.ORPHAN_CLUSTER_CREATION_THRESHOLD) || 0.65, // Fallback similarity for creating new episodes from orphans
  
  // DBSCAN clustering parameters 
  dbscan: {
    epsilon: parseFloat(process.env.DBSCAN_EPSILON) || 0.5, // Adjusted from 0.5 to potentially form clusters more easily
    minPoints: parseInt(process.env.DBSCAN_MIN_POINTS, 10) || 2, // Minimum points to form a cluster
  },
  
  // Episode parameters
  maxChunksPerEpisode: parseInt(process.env.MAX_CHUNKS_PER_EPISODE, 10) || 30, // Maximum chunks to include in a single episode
  episodeTimeWindowMs: 7 * 24 * 60 * 60 * 1000, // 1 week in milliseconds
  similarityThreshold: parseFloat(process.env.EPISODE_SIMILARITY_THRESHOLD) || 0.8, // Primary threshold to attach chunk to an episode
  multipleAttachmentSimilarityThreshold: parseFloat(process.env.MULTIPLE_ATTACHMENT_SIMILARITY_THRESHOLD) || 0.70, // Threshold for attaching to additional episodes
  newEpisodeSeedThreshold: parseFloat(process.env.NEW_EPISODE_SEED_THRESHOLD) || 0.60, // If max similarity is below this, consider seeding a new episode
  maxCandidateEpisodes: parseInt(process.env.MAX_CANDIDATE_EPISODES, 10) || 5, // Limit how many episodes we check similarity against
  
  // Thought generation parameters
  thought: {
    minEpisodesForThought: parseInt(process.env.MIN_EPISODES_FOR_THOUGHT, 10) || 2, // Minimum episodes to generate a thought
    minEpisodeSimilarity: parseFloat(process.env.MIN_EPISODE_SIMILARITY) || 0.65, // Lowered from 0.75 to match episode similarity threshold
    minImportance: parseFloat(process.env.MIN_THOUGHT_IMPORTANCE) || 0.5, // Lowered from 0.6 to generate more thoughts
  },
}; 