const aiService = require('../services/ai.service');
const aiConfig = require('../../config/ai.config');
const logger = require('./logger').childLogger('AIHelper');

/**
 * Generates a title and narrative summary for a collection of text items.
 * @param {string[]} contentItems - An array of text strings to summarize.
 * @param {string} contextDescription - A brief description of the context (e.g., "episode", "thought", "document summary").
 * @returns {Promise<{title: string, narrative: string}>}
 */
async function generateTitleAndNarrative(contentItems, contextDescription = 'collection of texts') {
  if (!contentItems || contentItems.length === 0) {
    logger.warn('[AIHelper] No content items provided for narrative generation.');
    return { title: `Untitled ${contextDescription}`, narrative: `No content provided for this ${contextDescription}.` };
  }

  const combinedText = contentItems.join('\n\n---\n\n'); // Join with a clear separator
  const promptTemplate = aiConfig.titleNarrativePromptTemplate || 
    `Based on the following collection of related text snippets, described as a "{CONTEXT_DESCRIPTION}", please generate a concise and descriptive title (max 10 words) and a short narrative summary (max 150 words) that captures the core theme or topic.

Format your response strictly as follows:
Title: [Your Title Here]
Narrative: [Your Narrative Here]

Snippets:
{CONTENT}`;
  
  const prompt = promptTemplate
    .replace('{CONTEXT_DESCRIPTION}', contextDescription)
    .replace('{CONTENT}', combinedText.substring(0, aiConfig.maxContextLengthForSummarization || 8000));

  try {
    const responseText = await aiService.getCompletion(prompt, {
      model: aiConfig.completionModel,
      max_tokens: aiConfig.maxTokensForSummarization || 250,
      temperature: aiConfig.temperatureForSummarization || 0.5,
    });

    let title = `Untitled ${contextDescription}`;
    let narrative = 'Could not generate narrative.';

    if (responseText) {
      const titleMatch = responseText.match(/Title: (.*)/);
      const narrativeMatch = responseText.match(/Narrative: (.*)/s); // s flag for dotall

      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].trim();
      }
      if (narrativeMatch && narrativeMatch[1]) {
        narrative = narrativeMatch[1].trim();
      }
    } else {
      logger.warn(`[AIHelper] AI completion for ${contextDescription} narrative generation returned null or empty.`);
    }
    return { title, narrative };
  } catch (error) {
    logger.error(`[AIHelper] Error generating ${contextDescription} narrative:`, { error });
    return { title: `Error Generating Title for ${contextDescription}`, narrative: `Error generating narrative for this ${contextDescription}.` };
  }
}

module.exports = {
  generateTitleAndNarrative,
}; 