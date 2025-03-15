/**
 * OpenAI API Service for Article to Audio Extension (Local Version)
 * Handles all API calls to OpenAI for text processing and audio generation
 */

import { getSetting } from './db.js';

/**
 * Make a request to OpenAI API
 * @param {string} endpoint - API endpoint (e.g., 'chat/completions')
 * @param {Object} data - Request data
 * @returns {Promise<Object>} Response data
 */
async function makeOpenAIRequest(endpoint, data) {
  const apiKey = await getSetting('openai_api_key');
  
  if (!apiKey) {
    throw new Error('OpenAI API key not found. Please add it in the extension settings.');
  }
  
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`OpenAI API error (${response.status}): ${errorData.error?.message || JSON.stringify(errorData)}`);
  }
  
  return await response.json();
}

/**
 * Generate a summary for an article
 * @param {string} text - Article text
 * @returns {Promise<string>} Generated summary
 */
async function generateSummary(text) {
  const data = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: `Summarize the following article concisely while maintaining key details, 
        covering the main topic, essential facts, important arguments, and any conclusions. 
        Highlight the who, what, when, where, why, and how (if applicable). Retain the 
        original tone—whether informative, analytical, or opinion-based—and include any 
        significant statistics, quotes, or expert opinions mentioned. Ensure clarity, 
        coherence, and neutrality (unless it is an opinion piece, in which case, reflect 
        the stance of the author accurately). If there are action points or takeaways, include 
        them in bullet points.`
      },
      {
        role: 'user',
        content: text
      }
    ],
    max_tokens: 500,
    temperature: 0.7
  };
  
  const response = await makeOpenAIRequest('chat/completions', data);
  return response.choices[0].message.content.trim();
}

/**
 * Generate a title for an article
 * @param {string} text - Article text
 * @returns {Promise<string>} Generated title
 */
async function generateTitle(text) {
  const data = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: 'Generate a concise, engaging title (maximum 10 words) for this article. Return only the title without quotes or additional text.'
      },
      {
        role: 'user',
        content: text
      }
    ],
    max_tokens: 50,
    temperature: 0.7
  };
  
  const response = await makeOpenAIRequest('chat/completions', data);
  return response.choices[0].message.content.trim();
}

/**
 * Generate an introduction script for a podcast
 * @param {Array<object>} articles - Array of articles with titles
 * @returns {Promise<string>} Generated introduction script
 */
async function generateIntroduction(articles) {
  const allArticleTitles = articles.map(article => article.title);
  
  const introPrompt = `You are hosting a podcast discussing recent news articles. Write a warm, engaging 
  introduction (about 100-150 words) for your podcast that introduces the following articles: ${allArticleTitles.join(', ')}. 
  Make it conversational and interesting, as if you are speaking to your audience. Include a brief 
  welcome and set the tone for the upcoming discussion.`;
  
  const data = {
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
  
  const response = await makeOpenAIRequest('chat/completions', data);
  return response.choices[0].message.content.trim();
}

/**
 * Generate an article discussion script for a podcast
 * @param {Object} article - Article with title and content/summary
 * @returns {Promise<string>} Generated article discussion script
 */
async function generateArticleDiscussion(article) {
  const articlePrompt = `You are hosting a podcast with a co-host discussing this article titled "${article.title}". 
  Create an engaging, conversational discussion script (about 300-400 words) between you (HOST) and your co-host (CO-HOST) 
  that covers the key points from the article. Include your thoughts, questions to each other, and insights. 
  Format the conversation clearly with "HOST:" and "CO-HOST:" prefixes for each speaker.
  
  Article content:
  ${article.content || article.summary}`;
  
  const data = {
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
  
  const response = await makeOpenAIRequest('chat/completions', data);
  return response.choices[0].message.content.trim();
}

/**
 * Generate a conclusion script for a podcast
 * @param {Array<object>} articles - Array of articles with titles
 * @returns {Promise<string>} Generated conclusion script
 */
async function generateConclusion(articles) {
  const allArticleTitles = articles.map(article => article.title);
  
  const conclusionPrompt = `You are wrapping up your podcast after discussing these articles: ${allArticleTitles.join(', ')}. 
  Write a thoughtful, engaging conclusion (about 100-150 words) that summarizes the key takeaways from your discussions. 
  Thank your listeners and encourage them to return for the next episode. Make it conversational and warm, as if you are 
  speaking directly to your audience.`;
  
  const data = {
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
  
  const response = await makeOpenAIRequest('chat/completions', data);
  return response.choices[0].message.content.trim();
}

/**
 * Parse a script into lines for each speaker
 * @param {string} script - Full podcast script
 * @param {Object} settings - Settings object containing hostNames, voiceMap, etc.
 * @returns {Array<Object>} Array of line objects with speaker and text
 */
function parseScriptIntoLines(script, settings = {}) {
  const lines = [];
  const scriptLines = script.split('\n');
  
  for (let i = 0; i < scriptLines.length; i++) {
    const line = scriptLines[i].trim();
    
    if (!line) continue;
    
    // Check for speaker patterns like "HOST:" or "CO-HOST:"
    // Use a more specific regex to match exactly HOST or CO-HOST
    const speakerMatch = line.match(/^(HOST|CO-HOST|Alice|Bob):\s*(.*)/i);
    
    if (speakerMatch) {
      const speaker = speakerMatch[1].trim().toUpperCase(); // Ensure consistent case
      const text = speakerMatch[2].trim();
      
      if (text) {
        // Split long text into chunks if needed
        const chunks = splitTextIntoChunks(`${speaker}: ${text}`, 4000);
        
        for (const chunk of chunks) {
          const chunkSpeakerMatch = chunk.match(/^(HOST|CO-HOST|Alice|Bob):\s*(.*)/i);
          if (chunkSpeakerMatch) {
            lines.push({ 
              speaker: chunkSpeakerMatch[1].trim().toUpperCase(), 
              text: chunkSpeakerMatch[2].trim(),
              settings: settings // Add settings to each line
            });
          }
        }
      }
    } else if (lines.length > 0) {
      // If no speaker pattern but we have previous lines, append to the last line
      const lastLine = lines[lines.length - 1];
      
      // Check if appending would make the line too long
      if ((lastLine.text + ' ' + line).length > 4000) {
        // Start a new line with the same speaker
        lines.push({ 
          speaker: lastLine.speaker, 
          text: line,
          settings: settings // Add settings to each line
        });
      } else {
        lastLine.text += ' ' + line;
      }
    } else {
      // If there's no speaker pattern and no previous lines, use a default speaker
      lines.push({ 
        speaker: 'HOST', 
        text: line,
        settings: settings // Add settings to each line
      });
    }
  }
  
  return lines;
}

/**
 * Split text into chunks that are below the API character limit
 * @param {string} text - Text to split into chunks
 * @param {number} maxLength - Maximum length for each chunk
 * @returns {Array<string>} Array of text chunks
 */
function splitTextIntoChunks(text, maxLength = 4000) {
  // If text is already below the limit, return it as is
  if (text.length <= maxLength) {
    return [text];
  }
  
  const chunks = [];
  let currentChunk = "";
  const speaker = text.match(/^(HOST|CO-HOST|Alice|Bob):/i)[1];
  const textWithoutSpeaker = text.replace(/^(HOST|CO-HOST|Alice|Bob):\s*/i, '');
  
  // Split by sentences to maintain natural breaks
  const sentences = textWithoutSpeaker.split(/(?<=\.\s+)/);
  
  for (const sentence of sentences) {
    // If adding this sentence would exceed the limit, start a new chunk
    if (currentChunk.length + sentence.length > maxLength) {
      if (currentChunk.length > 0) {
        chunks.push(`${speaker}: ${currentChunk}`);
        currentChunk = "";
      }
      
      // If a single sentence is too long, split it further by words
      if (sentence.length > maxLength) {
        const words = sentence.split(/\s+/);
        let wordChunk = "";
        
        for (const word of words) {
          if (wordChunk.length + word.length + 1 > maxLength) {
            chunks.push(`${speaker}: ${wordChunk}`);
            wordChunk = word;
          } else {
            wordChunk += (wordChunk ? " " : "") + word;
          }
        }
        
        if (wordChunk) {
          currentChunk = wordChunk;
        }
      } else {
        currentChunk = sentence;
      }
    } else {
      currentChunk += sentence;
    }
  }
  
  // Add any remaining text
  if (currentChunk) {
    chunks.push(`${speaker}: ${currentChunk}`);
  }
  
  return chunks;
}

/**
 * Assemble a full podcast script
 * @param {string} introduction - Introduction script
 * @param {Array<string>} articleScripts - Array of article discussion scripts
 * @param {string} conclusion - Conclusion script
 * @returns {string} Full podcast script
 */
function assembleFullScript(introduction, articleScripts, conclusion) {
  let fullScript = "HOST: " + introduction + "\n\n";
  
  for (let i = 0; i < articleScripts.length; i++) {
    fullScript += `\n--- ARTICLE ${i + 1} ---\n\n`;
    fullScript += articleScripts[i] + "\n\n";
  }
  
  fullScript += "\n--- CONCLUSION ---\n\n";
  fullScript += "HOST: " + conclusion;
  
  return fullScript;
}

/**
 * Generate audio from text
 * @param {string} text - Text to convert to audio
 * @param {string} voice - Voice to use (e.g., "alloy", "onyx")
 * @returns {Promise<Blob>} Audio blob
 */
async function generateAudio(text, voice = "alloy") {
  const apiKey = await getSetting('openai_api_key');
  
  if (!apiKey) {
    throw new Error('OpenAI API key not found. Please add it in the extension settings.');
  }
  
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: voice,
      input: text
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`OpenAI API error (${response.status}): ${errorData.error?.message || JSON.stringify(errorData)}`);
  }
  
  return await response.blob();
}

/**
 * Generate audio for all lines in a script
 * @param {Array<Object>} lines - Array of line objects with speaker and text
 * @param {Object} voiceMap - Map of speakers to voices
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Promise<Array<Blob>>} Array of audio blobs
 */
async function generateAudioForLines(lines, voiceMap = {}, progressCallback = () => {}) {
  const audioBlobs = [];
  const defaultVoice = "alloy";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const voice = voiceMap[line.speaker] || defaultVoice;
    
    try {
      progressCallback({
        currentLine: i + 1,
        totalLines: lines.length,
        progressPercent: Math.round(((i + 1) / lines.length) * 100)
      });
      
      const audioBlob = await generateAudio(line.text, voice);
      audioBlobs.push(audioBlob);
    } catch (error) {
      console.error(`Error generating audio for line ${i + 1}:`, error);
      throw error;
    }
  }
  
  return audioBlobs;
}

/**
 * Combine audio blobs into a single blob
 * @param {Array<Blob>} audioBlobs - Array of audio blobs
 * @returns {Promise<Blob>} Combined audio blob
 */
async function combineAudioBlobs(audioBlobs) {
  // Convert blobs to array buffers
  const arrayBuffers = await Promise.all(
    audioBlobs.map(blob => blob.arrayBuffer())
  );
  
  // Determine the total length
  const totalLength = arrayBuffers.reduce((total, buffer) => total + buffer.byteLength, 0);
  
  // Create a new array buffer of the total length
  const combinedBuffer = new Uint8Array(totalLength);
  
  // Copy each buffer into the combined buffer
  let offset = 0;
  for (const buffer of arrayBuffers) {
    const uint8Array = new Uint8Array(buffer);
    combinedBuffer.set(uint8Array, offset);
    offset += buffer.byteLength;
  }
  
  // Create a new blob from the combined buffer
  return new Blob([combinedBuffer], { type: 'audio/mpeg' });
}

// Export all functions
export {
  generateSummary,
  generateTitle,
  generateIntroduction,
  generateArticleDiscussion,
  generateConclusion,
  parseScriptIntoLines,
  splitTextIntoChunks,
  assembleFullScript,
  generateAudio,
  generateAudioForLines,
  combineAudioBlobs
}; 