/**
 * Content generation service for podcast scripts
 */

/**
 * Generate an introduction script for a podcast
 * @param {Array<object>} articles - Array of articles with titles
 * @param {object} openai - OpenAI client instance
 * @param {object} rateLimiter - Rate limiter instance
 * @returns {Promise<string>} Generated introduction script
 */
async function generateIntroduction(articles, openai, rateLimiter) {
  const allArticleTitles = articles.map(article => article.title);
  console.log("Generating introduction...");
  
  // Create introduction prompt
  const introPrompt = createIntroPrompt(allArticleTitles);

  // Introduction request
  const introRequest = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: introPrompt
      }
    ],
    max_tokens: 4096,
    temperature: 0.7
  };
  
  // More robust timeout implementation using Promise.race
  const introTimeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      const timeoutError = new Error(`Introduction generation request timed out after 60 seconds`);
      timeoutError.name = 'TimeoutError';
      reject(timeoutError);
    }, 60000); // 60 second timeout
  });
  
  console.log(`[${new Date().toISOString()}] Starting OpenAI API call for introduction`);
  
  const introResponse = await rateLimiter.executeRequest(
    async (data) => {
      try {
        // Use Promise.race to implement timeout
        const result = await Promise.race([
          openai.chat.completions.create(data),
          introTimeoutPromise
        ]);
        
        console.log(`[${new Date().toISOString()}] Completed OpenAI API call for introduction`);
        return result;
      } catch (err) {
        if (err.name === 'TimeoutError') {
          console.error(`TIMEOUT: OpenAI API call for introduction timed out after 60 seconds`);
        }
        throw err;
      }
    },
    introRequest
  );
  
  const introScript = introResponse.choices[0].message.content.trim();
  console.log("Introduction generated");
  return introScript;
}

/**
 * Generate article discussion scripts for a podcast
 * @param {Array<object>} articles - Array of articles with titles and content/summary
 * @param {object} openai - OpenAI client instance
 * @param {object} rateLimiter - Rate limiter instance
 * @returns {Promise<Array<string>>} Array of generated article discussion scripts
 */
async function generateArticleDiscussions(articles, openai, rateLimiter) {
  console.log("Generating discussions for each article...");
  const articleScripts = [];
  
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    console.log(`Generating discussion for article ${i + 1}: ${article.title}`);
    
    // Create prompt for this specific article
    const articlePrompt = createArticlePrompt(article);

    // Create article request with rate limiting
    const articleRequest = {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: articlePrompt
        }
      ],
      max_tokens: 4096,
      temperature: 0.7
    };
    
    // Use the rate limiter to make the API call
    // More robust timeout implementation using Promise.race
    const articleTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const timeoutError = new Error(`Article ${i + 1} generation request timed out after 60 seconds`);
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, 60000); // 60 second timeout
    });
    
    console.log(`[${new Date().toISOString()}] Starting OpenAI API call for article ${i + 1}`);
    
    const articleResponse = await rateLimiter.executeRequest(
      async (data) => {
        try {
          // Use Promise.race to implement timeout
          const result = await Promise.race([
            openai.chat.completions.create(data),
            articleTimeoutPromise
          ]);
          
          console.log(`[${new Date().toISOString()}] Completed OpenAI API call for article ${i + 1}`);
          return result;
        } catch (err) {
          if (err.name === 'TimeoutError') {
            console.error(`TIMEOUT: OpenAI API call for article ${i + 1} timed out after 60 seconds`);
          }
          throw err;
        }
      },
      articleRequest
    );
    
    const articleScript = articleResponse.choices[0].message.content.trim();
    articleScripts.push(articleScript);
    
    // Calculate and log the word count and estimated time
    const wordCount = articleScript.split(/\s+/).length;
    const estimatedMinutes = (wordCount / 150).toFixed(2); // Assuming ~150 words per minute for podcasts
    console.log(`Discussion generated for article ${i + 1}: ${wordCount} words, ~${estimatedMinutes} minutes`);
    
    // If the content seems too short, log a warning
    if (wordCount < 500) {
      console.warn(`WARNING: Article ${i + 1} discussion may be too short at ${wordCount} words (target: 525-550+ words)`);
    }
  }
  
  return articleScripts;
}

/**
 * Generate a conclusion script for a podcast
 * @param {Array<object>} articles - Array of articles with titles
 * @param {object} openai - OpenAI client instance
 * @param {object} rateLimiter - Rate limiter instance
 * @returns {Promise<string>} Generated conclusion script
 */
async function generateConclusion(articles, openai, rateLimiter) {
  const allArticleTitles = articles.map(article => article.title);
  console.log("Generating conclusion...");
  
  // Create conclusion prompt
  const conclusionPrompt = createConclusionPrompt(allArticleTitles);

  // Create conclusion request with rate limiting
  const conclusionRequest = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: conclusionPrompt
      }
    ],
    max_tokens: 4096,
    temperature: 0.7
  };
  
  // Use the rate limiter to make the API call
  // More robust timeout implementation using Promise.race
  const conclusionTimeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      const timeoutError = new Error(`Conclusion generation request timed out after 60 seconds`);
      timeoutError.name = 'TimeoutError';
      reject(timeoutError);
    }, 60000); // 60 second timeout
  });
  
  console.log(`[${new Date().toISOString()}] Starting OpenAI API call for conclusion`);
  
  const conclusionResponse = await rateLimiter.executeRequest(
    async (data) => {
      try {
        // Use Promise.race to implement timeout
        const result = await Promise.race([
          openai.chat.completions.create(data),
          conclusionTimeoutPromise
        ]);
        
        console.log(`[${new Date().toISOString()}] Completed OpenAI API call for conclusion`);
        return result;
      } catch (err) {
        if (err.name === 'TimeoutError') {
          console.error(`TIMEOUT: OpenAI API call for conclusion timed out after 60 seconds`);
        }
        throw err;
      }
    },
    conclusionRequest
  );
  
  const conclusionScript = conclusionResponse.choices[0].message.content.trim();
  console.log("Conclusion generated");
  return conclusionScript;
}

/**
 * Create prompt for introduction
 * @param {Array<string>} articleTitles - Array of article titles
 * @returns {string} Introduction prompt
 */
function createIntroPrompt(articleTitles) {
  return `You are two podcast hosts, Alice and Bob.

Create ONLY the introduction section for a podcast where two hosts engage in a dynamic 
and informative conversation about multiple articles. The introduction should be approximately 1 minute long.

Here are the titles of all articles that will be discussed:
${articleTitles.join('\n')}

The introduction should include:
- Alice greeting listeners and introducing Bob.
- Brief overview of the episode's topic and its relevance.
- Mention that today you'll be discussing ALL of these topics: ${articleTitles.join(', ')}
- Create excitement about the full range of articles being covered in this episode.
- Indicate that this will be a longer, in-depth episode with substantial time devoted to each topic.

DO NOT start discussing any specific article yet - this is ONLY the introduction.

${createToneStyleTemplate()}

${createGuidelinesTemplate()}

${createFormatTemplate()}`;
}

/**
 * Create prompt for article discussion
 * @param {object} article - Article with title and content/summary
 * @returns {string} Article discussion prompt
 */
function createArticlePrompt(article) {
  return `You are two podcast hosts, Alice and Bob.

You are in the middle of a podcast episode where you're discussing multiple articles.
You've already introduced the podcast and now need to create a focused discussion about this specific article:

Title: ${article.title}
${article.summary || article.content}

${createMainDiscussionTemplate()}

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

${createToneStyleTemplate()}

${createGuidelinesTemplate()}

${createFormatTemplate()}`;
}

/**
 * Create prompt for conclusion
 * @param {Array<string>} articleTitles - Array of article titles
 * @returns {string} Conclusion prompt
 */
function createConclusionPrompt(articleTitles) {
  return `You are two podcast hosts, Alice and Bob.

Create ONLY the conclusion section for a podcast where you've just finished discussing these articles:
${articleTitles.join('\n')}

The conclusion should be approximately 1 minute long and include:
- Hosts summarizing key takeaways from the discussions.
- Encouragement for listeners to reflect on the topics or engage further.
- Thanking the audience for listening and mentioning any future episodes.

This is ONLY the conclusion - assume all articles have already been thoroughly discussed.

${createToneStyleTemplate()}

${createGuidelinesTemplate()}

${createFormatTemplate()}`;
}

/**
 * Create main discussion template
 * @returns {string} Main discussion template
 */
function createMainDiscussionTemplate() {
  return `Create a focused discussion about this specific article that will last for at least 3.5 minutes:
  - Definition and Background (45-60 seconds):
    - Alice defines the topic and provides historical context.
    - Bob adds interesting facts or anecdotes related to the topic.
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
  
  IMPORTANT: The discussion for this article should try to be 3.5 minutes in total. Ensure sufficient depth and detail in each section to meet this time requirement.`;
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
 * @returns {string} Guidelines template
 */
function createGuidelinesTemplate() {
  return `Additional Guidelines:
  - Ensure a balanced exchange between both hosts, allowing each to contribute equally.
  - Use clear and concise language, avoiding jargon unless it's explained.
  - Aim for smooth transitions between topics to maintain listener interest.
  - IMPORTANT: DO NOT use terms like "Segment 1" or "Section 2" in the actual dialogue.
  - Consider the use of rhetorical questions to engage the audience and provoke thought.
  - ALWAYS refer to the hosts by their actual names (Alice and Bob), not as "Host 1" or "Host 2".`;
}

/**
 * Create format template
 * @returns {string} Format template
 */
function createFormatTemplate() {
  return `Format it like a real dialogue:
Alice: ...
Bob: ...
Alice: ...
Bob: ...
Continue this structure with natural conversation flow.`;
}

/**
 * Parse a script into lines for each speaker
 * @param {string} script - Full script
 * @returns {Array<string>} Array of speaker lines
 */
function parseScriptIntoLines(script) {
  return script.split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.trim())
    .filter(line => line.match(/^(Alice|Bob):?/i)); // Only keep lines with Alice or Bob prefixes
}

/**
 * Assemble a full script from parts
 * @param {string} introScript - Introduction script
 * @param {Array<string>} articleScripts - Array of article discussion scripts
 * @param {string} conclusionScript - Conclusion script
 * @returns {string} Assembled full script
 */
function assembleFullScript(introScript, articleScripts, conclusionScript) {
  return [
    introScript,
    ...articleScripts,
    conclusionScript
  ].join('\n\n');
}

module.exports = {
  generateIntroduction,
  generateArticleDiscussions,
  generateConclusion,
  parseScriptIntoLines,
  assembleFullScript
}; 