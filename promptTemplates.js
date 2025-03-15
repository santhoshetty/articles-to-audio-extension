/**
 * Prompt template functions for podcast generation
 */

/**
 * Create prompt for introduction
 * @param {Array<string>} articleTitles - Array of article titles
 * @param {object} settings - Settings object with host names
 * @returns {string} Introduction prompt
 */
function createIntroPrompt(articleTitles, settings) {
  const hostName = settings.hostNames['HOST'];
  const cohostName = settings.hostNames['CO-HOST'];
  
  return `You are two podcast hosts, ${hostName} and ${cohostName}.

Create ONLY the introduction section for a podcast where two hosts engage in a dynamic 
and informative conversation about multiple articles. The introduction should be approximately 1 minute long.

Here are the titles of all articles that will be discussed:
${articleTitles.join('\n')}

The introduction should include:
- ${hostName} greeting listeners and introducing ${cohostName}.
- Brief overview of the episode's topic and its relevance.
- Mention that today you'll be discussing ALL of these topics: ${articleTitles.join(', ')}
- Create excitement about the full range of articles being covered in this episode.
- Indicate that this will be a longer, in-depth episode with substantial time devoted to each topic.

DO NOT start discussing any specific article yet - this is ONLY the introduction.

${createToneStyleTemplate()}

${createGuidelinesTemplate(hostName, cohostName)}

${createFormatTemplate(hostName, cohostName)}`;
}

/**
 * Create prompt for article discussion
 * @param {object} article - Article with title and content/summary
 * @param {object} settings - Settings object with host names
 * @returns {string} Article discussion prompt
 */
function createArticlePrompt(article, settings) {
  const hostName = settings.hostNames['HOST'];
  const cohostName = settings.hostNames['CO-HOST'];
  
  return `You are two podcast hosts, ${hostName} and ${cohostName}.

You are in the middle of a podcast episode where you're discussing multiple articles.
You've already introduced the podcast and now need to create a focused discussion about this specific article:

Title: ${article.title}
${article.summary || article.content}

${createMainDiscussionTemplate(hostName, cohostName)}

IMPORTANT:
- DO NOT create an introduction for the podcast - you're already in the middle of the episode.
- DO NOT include any conclusion for the overall podcast.
- DO NOT reference that this is "the first article" or "the next article" or use any numbering.
- If this isn't the first article, start with a natural transition from a previous topic.
- CRITICAL: Your response MUST contain enough detailed content to fill AT LEAST 3.5 minutes of speaking time.
- Each section should be comprehensive and in-depth - be thorough in your analysis and discussion.
- Include substantial dialogue for each point - aim for 2-3 exchanges between hosts per subtopic.
- Remember that spoken content takes longer than reading - aim for approximately 525-550 words minimum.
- The final output should feel like a complete, substantive segment that could stand on its own.
- Addressing the opposite host by name is not required, but feel free to do so if it makes sense in the context of the discussion. But lean towards not using it.
- Include things like "Hmm", shock responses, and other natural human reactions to the topics WHERE APPLICABLE ONLY.

${createToneStyleTemplate()}

${createGuidelinesTemplate(hostName, cohostName)}

${createFormatTemplate(hostName, cohostName)}`;
}

/**
 * Create prompt for conclusion
 * @param {Array<string>} articleTitles - Array of article titles
 * @param {object} settings - Settings object with host names
 * @returns {string} Conclusion prompt
 */
function createConclusionPrompt(articleTitles, settings) {
  const hostName = settings.hostNames['HOST'];
  const cohostName = settings.hostNames['CO-HOST'];
  
  return `You are two podcast hosts, ${hostName} and ${cohostName}.

Create ONLY the conclusion section for a podcast where you've just finished discussing these articles:
${articleTitles.join('\n')}

The conclusion should be approximately 1 minute long and include:
- Hosts summarizing key takeaways from the discussions.
- Encouragement for listeners to reflect on the topics or engage further.
- Thanking the audience for listening and mentioning any future episodes.

This is ONLY the conclusion - assume all articles have already been thoroughly discussed.

${createToneStyleTemplate()}

${createGuidelinesTemplate(hostName, cohostName)}

${createFormatTemplate(hostName, cohostName)}`;
}

/**
 * Create main discussion template
 * @param {string} hostName - Name of the host
 * @param {string} cohostName - Name of the co-host
 * @returns {string} Main discussion template
 */
function createMainDiscussionTemplate(hostName, cohostName) {
  return `Create a focused discussion about this specific article that will last for at least 3.5 minutes:
  - Definition and Background (45-60 seconds):
    - ${hostName} defines the topic and provides historical context.
    - ${cohostName} adds interesting facts or anecdotes related to the topic.
    - Include sufficient detail to properly introduce the topic to listeners.
    - Provide at least 3-4 exchanges between hosts in this section.
  
  - Current Relevance and Applications (60-75 seconds):
    - Both hosts discuss how the topic applies in today's world.
    - Include real-world examples, case studies, or recent news.
    - Explore multiple areas where this topic has current relevance and impact.
    - This should be your most detailed section with at least 4-5 exchanges between hosts.
  
  - Challenges and Controversies (45-60 seconds):
    - Hosts explore any debates or challenges associated with the topic.
    - Present multiple viewpoints to provide a balanced perspective.
    - Discuss potential solutions or approaches to these challenges.
    - Include at least 3-4 exchanges between hosts in this section.
  
  - Future Outlook (30-45 seconds):
    - Hosts speculate on the future developments related to the topic.
    - Discuss potential innovations or changes on the horizon.
    - Consider how this might affect listeners or society as a whole.
    - Include at least 2-3 exchanges between hosts to wrap up the discussion.
  
  IMPORTANT: 
  - The discussion for this article should try to be 3.5 minutes in total. Ensure sufficient depth and detail in each section to meet this time requirement.
  - DO NOT address the opposite speaker by name in every line. Only include it rarely. Lean towards not using it.`;
}

/**
 * Create tone and style template
 * @returns {string} Tone and style template
 */
function createToneStyleTemplate() {
  return `Tone and Style:
  - Conversational and engaging, as if speaking directly to the listener.
  - Use inclusive language to foster a sense of community.
  - Incorporate light humor or personal anecdotes where appropriate to humanize the discussion.`;
}

/**
 * Create guidelines template
 * @param {string} hostName - Name of the host
 * @param {string} cohostName - Name of the co-host
 * @returns {string} Guidelines template
 */
function createGuidelinesTemplate(hostName, cohostName) {
  return `Additional Guidelines:
  - Ensure a balanced exchange between both hosts, allowing each to contribute equally.
  - Use clear and concise language, avoiding jargon unless it's explained.
  - Aim for smooth transitions between topics to maintain listener interest.
  - IMPORTANT: DO NOT use terms like "Segment 1" or "Section 2" in the actual dialogue.
  - Consider the use of rhetorical questions to engage the audience and provoke thought.
  - ALWAYS refer to the hosts by their actual names (${hostName} and ${cohostName}), not as "Host 1" or "Host 2".`;
}

/**
 * Create format template
 * @param {string} hostName - Name of the host
 * @param {string} cohostName - Name of the co-host
 * @returns {string} Format template
 */
function createFormatTemplate(hostName, cohostName) {
  return `Format it like a real dialogue:
${hostName}: ...
${cohostName}: ...
${hostName}: ...
${cohostName}: ...
Continue this structure with natural conversation flow.`;
}

export {
  createIntroPrompt,
  createArticlePrompt,
  createConclusionPrompt,
  createMainDiscussionTemplate,
  createToneStyleTemplate,
  createGuidelinesTemplate,
  createFormatTemplate
}; 