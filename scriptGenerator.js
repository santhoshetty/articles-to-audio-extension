/**
 * Script generation functions for podcast generation
 */

import { 
  assembleFullScript, 
  parseScriptIntoLines 
} from './openai.js';

import {
  getArticleById,
  updateArticle,
  getSetting
} from './db.js';

import {
  createIntroPrompt,
  createArticlePrompt,
  createConclusionPrompt
} from './promptTemplates.js';

import { executeWithTimeout } from './utils.js';

/**
 * Generate a podcast script from selected articles
 * @param {Array<number>} articleIds - Array of article IDs
 * @param {Object} options - Generation options
 * @param {Function} progressCallback - Callback for progress updates
 * @param {AbortController} [abortController] - Optional AbortController to cancel the operation
 * @returns {Promise<Object>} Script and metadata
 */
async function generatePodcastScript(articleIds, options = {}, progressCallback = () => {}, abortController = null) {
  // Create a local abort controller if none provided
  const controller = abortController || new AbortController();
  const signal = controller.signal;
  
  // Default options
  const defaultOptions = {
    voiceMap: {
      'HOST': 'onyx',
      'CO-HOST': 'alloy'
    },
    hostNames: {
      'HOST': 'Alex',
      'CO-HOST': 'Jordan'
    },
    title: 'Generated Podcast',
    includeIntroduction: true,
    includeConclusion: true,
    model: 'gpt-3.5-turbo',
    maxTokens: 4096,
    temperature: 0.7,
    timeoutSeconds: 60
  };
  
  // Merge options
  const settings = { ...defaultOptions, ...options };
  
  try {
    // Check for abortion before starting
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    // Load articles
    progressCallback({ stage: 'loading', message: 'Loading articles...', progress: 5 });
    const articles = [];
    
    for (const id of articleIds) {
      // Check for cancellation before each article fetch
      if (signal.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      const article = await getArticleById(id);
      if (!article) {
        throw new Error(`Article with ID ${id} not found`);
      }
      articles.push(article);
    }
    
    // Generate podcast title if not provided
    if (!settings.title || settings.title === defaultOptions.title) {
      progressCallback({ stage: 'title', message: 'Generating podcast title...', progress: 10 });
      // Create a simple title based on the number of articles
      settings.title = `Podcast: ${articles.map(a => a.title).join(', ')}`.substring(0, 100);
    }
    
    // Get OpenAI API key
    const openaiApiKey = await getSetting('openai_api_key');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not found in settings');
    }
    
    // Generate introduction if enabled
    let introduction = '';
    if (settings.includeIntroduction) {
      // Check for cancellation before generating introduction
      if (signal.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      progressCallback({ stage: 'introduction', message: 'Generating introduction...', progress: 15 });
      introduction = await generateIntroduction(articles, openaiApiKey, settings, controller);
    }
    
    // Generate article discussions
    const articleScripts = [];
    for (let i = 0; i < articles.length; i++) {
      // Check for cancellation before each article discussion
      if (signal.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      const progressPercent = 20 + Math.round((i / articles.length) * 30);
      progressCallback({ 
        stage: 'discussion', 
        message: `Generating discussion for article ${i + 1}/${articles.length}...`, 
        progress: progressPercent 
      });
      
      const script = await generateArticleDiscussion(articles[i], openaiApiKey, settings, controller);
      articleScripts.push(script);
      
      // Update article with script if it doesn't have one yet
      if (!articles[i].podcastScript) {
        await updateArticle({
          ...articles[i],
          podcastScript: script
        });
      }
    }
    
    // Generate conclusion if enabled
    let conclusion = '';
    if (settings.includeConclusion) {
      // Check for cancellation before generating conclusion
      if (signal.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      progressCallback({ stage: 'conclusion', message: 'Generating conclusion...', progress: 55 });
      conclusion = await generateConclusion(articles, openaiApiKey, settings, controller);
    }
    
    // Check for cancellation before final assembly
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    // Assemble full script
    progressCallback({ stage: 'script', message: 'Assembling podcast script...', progress: 60 });
    const fullScript = assembleFullScript(introduction, articleScripts, conclusion);
    
    // Parse script into lines
    const lines = parseScriptIntoLines(fullScript, settings);
    
    return {
      title: settings.title,
      articleIds: articleIds,
      script: fullScript,
      lines: lines,
      settings: settings
    };
  } catch (error) {
    if (signal.aborted) {
      console.log('Podcast script generation was cancelled');
      progressCallback({ stage: 'cancelled', message: 'Operation cancelled', progress: 0 });
    } else {
      console.error('Error generating podcast script:', error);
      progressCallback({ stage: 'error', message: error.message, error });
    }
    throw error;
  }
}

/**
 * Generate introduction script for a podcast
 * @param {Array<object>} articles - Array of articles with titles
 * @param {string} openaiApiKey - OpenAI API key
 * @param {object} settings - Settings object
 * @param {AbortController} [abortController] - Optional AbortController to cancel the operation
 * @returns {Promise<string>} Generated introduction script
 */
async function generateIntroduction(articles, openaiApiKey, settings, abortController = null) {
  // Use provided abort controller or create a new one
  const controller = abortController || new AbortController();
  const signal = controller.signal;
  
  const allArticleTitles = articles.map(article => article.title);
  console.log("Generating introduction...");
  
  // Create introduction prompt
  const introPrompt = createIntroPrompt(allArticleTitles, settings);

  // Introduction request
  const introRequest = {
    model: settings.model,
    messages: [
      {
        role: 'system',
        content: introPrompt
      }
    ],
    max_tokens: settings.maxTokens,
    temperature: settings.temperature
  };
  
  try {
    // Check if already aborted
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    console.log(`[${new Date().toISOString()}] Starting OpenAI API call for introduction`);
    
    // Execute with timeout and abort controller
    const introResponse = await executeWithTimeout(
      async () => {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(introRequest),
          signal: signal  // Pass the abort signal to fetch
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
        }
        
        return await response.json();
      },
      settings.timeoutSeconds * 1000,
      signal
    );
    
    console.log(`[${new Date().toISOString()}] Completed OpenAI API call for introduction`);
    const introScript = introResponse.choices[0].message.content.trim();
    console.log("Introduction generated");
    return introScript;
  } catch (error) {
    if (signal.aborted) {
      console.log('Introduction generation was cancelled');
      throw new Error('Operation was cancelled');
    }
    console.error(`Error generating introduction: ${error.message}`);
    throw error;
  }
}

/**
 * Generate article discussion script for a podcast
 * @param {object} article - Article with title and content/summary
 * @param {string} openaiApiKey - OpenAI API key
 * @param {object} settings - Settings object
 * @param {AbortController} [abortController] - Optional AbortController to cancel the operation
 * @returns {Promise<string>} Generated article discussion script
 */
async function generateArticleDiscussion(article, openaiApiKey, settings, abortController = null) {
  // Use provided abort controller or create a new one
  const controller = abortController || new AbortController();
  const signal = controller.signal;
  
  console.log(`Generating discussion for article: ${article.title}`);
  
  // Create prompt for this specific article
  const articlePrompt = createArticlePrompt(article, settings);

  // Create article request
  const articleRequest = {
    model: settings.model,
    messages: [
      {
        role: 'system',
        content: articlePrompt
      }
    ],
    max_tokens: settings.maxTokens,
    temperature: settings.temperature
  };
  
  try {
    // Check if already aborted
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    console.log(`[${new Date().toISOString()}] Starting OpenAI API call for article discussion`);
    
    // Execute with timeout and abort controller
    const articleResponse = await executeWithTimeout(
      async () => {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(articleRequest),
          signal: signal  // Pass the abort signal to fetch
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
        }
        
        return await response.json();
      },
      settings.timeoutSeconds * 1000,
      signal
    );
    
    console.log(`[${new Date().toISOString()}] Completed OpenAI API call for article discussion`);
    const articleScript = articleResponse.choices[0].message.content.trim();
    
    // Calculate and log the word count and estimated time
    const wordCount = articleScript.split(/\s+/).length;
    const estimatedMinutes = (wordCount / 150).toFixed(2); // Assuming ~150 words per minute for podcasts
    console.log(`Discussion generated: ${wordCount} words, ~${estimatedMinutes} minutes`);
    
    // If the content seems too short, log a warning
    if (wordCount < 500) {
      console.warn(`WARNING: Article discussion may be too short at ${wordCount} words (target: 525-550+ words)`);
    }
    
    return articleScript;
  } catch (error) {
    if (signal.aborted) {
      console.log('Article discussion generation was cancelled');
      throw new Error('Operation was cancelled');
    }
    console.error(`Error generating article discussion: ${error.message}`);
    throw error;
  }
}

/**
 * Generate conclusion script for a podcast
 * @param {Array<object>} articles - Array of articles with titles
 * @param {string} openaiApiKey - OpenAI API key
 * @param {object} settings - Settings object
 * @param {AbortController} [abortController] - Optional AbortController to cancel the operation
 * @returns {Promise<string>} Generated conclusion script
 */
async function generateConclusion(articles, openaiApiKey, settings, abortController = null) {
  // Use provided abort controller or create a new one
  const controller = abortController || new AbortController();
  const signal = controller.signal;
  
  const allArticleTitles = articles.map(article => article.title);
  console.log("Generating conclusion...");
  
  // Create conclusion prompt
  const conclusionPrompt = createConclusionPrompt(allArticleTitles, settings);

  // Create conclusion request
  const conclusionRequest = {
    model: settings.model,
    messages: [
      {
        role: 'system',
        content: conclusionPrompt
      }
    ],
    max_tokens: settings.maxTokens,
    temperature: settings.temperature
  };
  
  try {
    // Check if already aborted
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    console.log(`[${new Date().toISOString()}] Starting OpenAI API call for conclusion`);
    
    // Execute with timeout and abort controller
    const conclusionResponse = await executeWithTimeout(
      async () => {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(conclusionRequest),
          signal: signal  // Pass the abort signal to fetch
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
        }
        
        return await response.json();
      },
      settings.timeoutSeconds * 1000,
      signal
    );
    
    console.log(`[${new Date().toISOString()}] Completed OpenAI API call for conclusion`);
    const conclusionScript = conclusionResponse.choices[0].message.content.trim();
    console.log("Conclusion generated");
    return conclusionScript;
  } catch (error) {
    if (signal.aborted) {
      console.log('Conclusion generation was cancelled');
      throw new Error('Operation was cancelled');
    }
    console.error(`Error generating conclusion: ${error.message}`);
    throw error;
  }
}

export {
  generatePodcastScript,
  generateIntroduction,
  generateArticleDiscussion,
  generateConclusion
}; 