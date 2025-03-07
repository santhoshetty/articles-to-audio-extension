const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const functions = require('@google-cloud/functions-framework');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
// Need axios for the direct OpenAI API calls
const axios = require('axios');

// Add utility for memory monitoring
const process = require('process');

// Rate Limiter Implementation
class RateLimiter {
  constructor({
    maxRequestsPerMinute = 60,    // Default to 60 requests per minute
    maxTokensPerMinute = 90000,   // Default to 90K tokens per minute 
    logLevel = 'info'             // Default log level
  } = {}) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.maxTokensPerMinute = maxTokensPerMinute;
    this.availableRequestCapacity = maxRequestsPerMinute;
    this.availableTokenCapacity = maxTokensPerMinute;
    this.lastUpdateTime = Date.now();
    this.requestQueue = [];
    this.retryDelay = 2000; // Start with 2s retry delay
    this.maxRetryDelay = 30000; // Maximum retry delay of 30s
    this.rateLimitHitCount = 0;
    this.apiErrorCount = 0;
    this.requestSuccessCount = 0;
    this.lastRateLimitTime = 0;
    this.status = {
      inProgress: 0,
      completed: 0,
      failed: 0,
      totalTokensUsed: 0
    };
    this.logLevel = logLevel;
  }

  // Log with different levels
  log(level, message, data = {}) {
    const levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };

    const logLevelValue = levels[this.logLevel] || 2;
    
    if (levels[level] <= logLevelValue) {
      const memoryUsage = process.memoryUsage();
      const formattedMemory = {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
      };
      
      switch (level) {
        case 'error':
          console.error('[RateLimiter ERROR]', message, { ...data, memoryUsage: formattedMemory });
          break;
        case 'warn':
          console.warn('[RateLimiter WARNING]', message, { ...data, memoryUsage: formattedMemory });
          break;
        case 'info':
          console.info('[RateLimiter INFO]', message, { ...data, memoryUsage: formattedMemory });
          break;
        case 'debug':
          console.debug('[RateLimiter DEBUG]', message, { ...data, memoryUsage: formattedMemory });
          break;
      }
    }
  }

  // Update available capacity based on time passed
  updateCapacity() {
    const currentTime = Date.now();
    const secondsSinceUpdate = (currentTime - this.lastUpdateTime) / 1000;
    
    // Update request capacity (requests per minute -> requests per second)
    this.availableRequestCapacity = Math.min(
      this.availableRequestCapacity + (this.maxRequestsPerMinute * secondsSinceUpdate / 60),
      this.maxRequestsPerMinute
    );
    
    // Update token capacity (tokens per minute -> tokens per second)
    this.availableTokenCapacity = Math.min(
      this.availableTokenCapacity + (this.maxTokensPerMinute * secondsSinceUpdate / 60),
      this.maxTokensPerMinute
    );
    
    this.lastUpdateTime = currentTime;
    
    this.log('debug', 'Capacity updated', {
      availableRequestCapacity: this.availableRequestCapacity.toFixed(2),
      availableTokenCapacity: this.availableTokenCapacity.toFixed(2),
      secondsSinceUpdate
    });
  }

  // Calculate token consumption for API calls
  estimateTokenConsumption(request) {
    // Default tokenEstimation handles arbitrary requests
    let inputTokens = 0;
    let outputTokens = 0;
    
    // For Chat Completions
    if (request.messages) {
      // Very rough estimation: 1 token ≈ 4 characters
      inputTokens = JSON.stringify(request.messages).length / 4;
      // Estimate based on max_tokens if provided, otherwise use a default
      outputTokens = request.max_tokens || 1000;
    } 
    // For TTS
    else if (request.input) {
      // For audio.speech, estimate 1 token ≈ 4 characters
      inputTokens = request.input.length / 4;
      // Audio output doesn't consume output tokens in the same way
      outputTokens = 0;
    }
    
    return {
      inputTokens: Math.ceil(inputTokens),
      outputTokens: Math.ceil(outputTokens),
      totalTokens: Math.ceil(inputTokens + outputTokens)
    };
  }

  // Check if we have capacity for this request
  hasCapacity(tokenCount) {
    this.updateCapacity();
    
    const hasRequestCapacity = this.availableRequestCapacity >= 1;
    const hasTokenCapacity = this.availableTokenCapacity >= tokenCount;
    
    this.log('debug', 'Capacity check', {
      hasRequestCapacity,
      hasTokenCapacity,
      requestCapacity: this.availableRequestCapacity.toFixed(2),
      tokenCapacity: this.availableTokenCapacity.toFixed(2),
      requiredTokens: tokenCount
    });
    
    return hasRequestCapacity && hasTokenCapacity;
  }

  // Consume capacity for a request
  consumeCapacity(tokenCount) {
    this.availableRequestCapacity -= 1;
    this.availableTokenCapacity -= tokenCount;
    
    this.log('debug', 'Capacity consumed', {
      remainingRequestCapacity: this.availableRequestCapacity.toFixed(2),
      remainingTokenCapacity: this.availableTokenCapacity.toFixed(2),
      tokensConsumed: tokenCount
    });
  }

  // Execute an API request with rate limiting and retries
  async executeRequest(apiCall, requestData, maxAttempts = 5) {
    const startTime = Date.now();
    let attempt = 0;
    let lastError = null;
    
    // Track this request in our status
    this.status.inProgress++;
    
    // Estimate token consumption
    const tokenEstimate = this.estimateTokenConsumption(requestData);
    
    this.log('info', 'API request queued', {
      requestType: apiCall.name || 'Unknown',
      tokenEstimate,
      maxAttempts
    });
    
    while (attempt < maxAttempts) {
      attempt++;
      
      // Check if we have capacity
      if (!this.hasCapacity(tokenEstimate.totalTokens)) {
        // Wait a bit before trying again
        const waitTime = 1000; // 1 second
        this.log('debug', `Waiting for capacity, attempt ${attempt}`, {
          waitTime,
          tokenEstimate
        });
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Consume capacity
      this.consumeCapacity(tokenEstimate.totalTokens);
      
      try {
        this.log('debug', `Making API request, attempt ${attempt}`, { request: requestData });
        const result = await apiCall(requestData);
        
        // Log success
        const duration = Date.now() - startTime;
        this.status.inProgress--;
        this.status.completed++;
        this.status.totalTokensUsed += tokenEstimate.totalTokens;
        this.requestSuccessCount++;
        
        this.log('info', 'API request succeeded', {
          attempts: attempt,
          duration: `${duration}ms`,
          requestType: apiCall.name || 'Unknown'
        });
        
        return result;
      } catch (error) {
        // Format error for logging
        const errorMessage = error.message || 'Unknown error';
        const statusCode = error.status || 'unknown';
        const errorResponse = error.response?.data || error.response || {};
        
        // Check for rate limit errors
        const isRateLimit = errorMessage.toLowerCase().includes('rate limit') || 
                           statusCode === 429 ||
                           (errorResponse.error && 
                            errorResponse.error.type === 'rate_limit_exceeded');
        
        if (isRateLimit) {
          this.rateLimitHitCount++;
          this.lastRateLimitTime = Date.now();
          
          // Calculate retry delay with exponential backoff
          const retryAfter = parseInt(error.response?.headers?.['retry-after'] || '1', 10);
          const delay = Math.min(this.maxRetryDelay, retryAfter * 1000 || this.retryDelay);
          this.retryDelay = Math.min(this.maxRetryDelay, this.retryDelay * 2); // Exponential backoff
          
          this.log('warn', `Rate limit hit, will retry after delay`, {
            retryDelay: `${delay}ms`,
            attempt,
            rateLimitHitCount: this.rateLimitHitCount
          });
          
          // Wait for the specified delay
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // It's not a rate limit error
          this.apiErrorCount++;
          this.retryDelay = 2000; // Reset retry delay for non-rate-limit errors
          
          this.log('error', `API request error, will retry`, {
            errorMessage,
            statusCode,
            attempt,
            maxAttempts,
            errorResponse
          });
          
          // Short delay before retry for non-rate-limit errors
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        lastError = error;
      }
    }
    
    // All attempts failed
    this.status.inProgress--;
    this.status.failed++;
    
    this.log('error', 'API request failed after all attempts', {
      attempts: attempt,
      lastError: lastError?.message || 'Unknown error',
      duration: `${Date.now() - startTime}ms`
    });
    
    throw lastError || new Error('Request failed after maximum retry attempts');
  }
  
  // Get current status
  getStatus() {
    return {
      ...this.status,
      rateLimitHitCount: this.rateLimitHitCount,
      apiErrorCount: this.apiErrorCount,
      requestSuccessCount: this.requestSuccessCount,
      currentCapacity: {
        requests: this.availableRequestCapacity.toFixed(2),
        tokens: this.availableTokenCapacity.toFixed(2)
      }
    };
  }
}

// Memory monitoring function
function logMemoryUsage(prefix = '') {
  const memoryUsage = process.memoryUsage();
  console.log(`${prefix} Memory Usage:`, {
    rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,       // Total memory allocated
    heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`, // Total size of allocated heap
    heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,  // Actual memory used
    external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`   // Memory used by C++ objects
  });
}

// Function to log buffer sizes
function logBufferSizes(buffers, prefix = '') {
  if (!buffers || !Array.isArray(buffers)) {
    console.log(`${prefix} Buffer tracking: No buffers to measure`);
    return;
  }
  
  // Calculate individual and total sizes
  const individualSizes = buffers.map(buf => buf.length);
  const totalSize = individualSizes.reduce((acc, size) => acc + size, 0);
  
  // Format sizes for readable output
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  };
  
  // Calculate statistics
  const averageSize = individualSizes.length > 0 ? totalSize / individualSizes.length : 0;
  const maxSize = individualSizes.length > 0 ? Math.max(...individualSizes) : 0;
  const minSize = individualSizes.length > 0 ? Math.min(...individualSizes) : 0;
  
  console.log(`${prefix} Buffer Sizes:`, {
    count: individualSizes.length,
    totalSize: formatSize(totalSize),
    totalSizeBytes: totalSize,
    averageSize: formatSize(averageSize),
    maxSegmentSize: formatSize(maxSize),
    minSegmentSize: formatSize(minSize),
    lastFiveSegments: individualSizes.slice(-5).map(formatSize)
  });
  
  return totalSize;
}

// Secret Manager client for accessing secrets
const secretManagerClient = new SecretManagerServiceClient();

// Helper function to access secrets
async function accessSecret(secretName) {
  const name = `projects/supabase-451007/secrets/${secretName}/versions/latest`;
  console.log("Accessing secret:", name);
  const [version] = await secretManagerClient.accessSecretVersion({ name });
  return version.payload.data.toString();
}

/**
 * Generate audio with timeout using a direct API call
 * @param {string} text - Text to convert to speech
 * @param {string} voice - Voice to use (e.g., "alloy", "onyx")
 * @param {string} openaiApiKey - OpenAI API key
 * @param {number} timeoutSeconds - Timeout in seconds
 * @returns {Promise<Buffer>} - Audio buffer
 */
async function generateAudioWithTimeout(text, voice, openaiApiKey, timeoutSeconds = 60) {
  const traceId = trace.start('generateAudioWithTimeout');
  console.log(`[${new Date().toISOString()}] Starting audio generation with timeout for: "${text.substring(0, 50)}..."`);

  // Create a direct HTTP request to OpenAI API using axios with timeout
  const axios = require('axios');
  
  // Create an AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutSeconds * 1000);
  
  try {
    trace.checkpoint(`Sending OpenAI API request for audio generation (voice: ${voice}, text length: ${text.length})`);
    // Make a direct request to OpenAI API
    const response = await axios({
      method: 'post',
      url: 'https://api.openai.com/v1/audio/speech',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: 'tts-1',
        voice: voice,
        input: text
      },
      responseType: 'arraybuffer',
      signal: controller.signal,
      timeout: timeoutSeconds * 1000 // Axios timeout as backup
    });
    
    trace.checkpoint(`OpenAI API request successful, received ${response.data.length} bytes`);
    // Convert the response to a buffer
    const buffer = Buffer.from(response.data);
    trace.end(traceId, 'generateAudioWithTimeout');
    return buffer;
  } catch (error) {
    trace.checkpoint(`OpenAI API request failed: ${error.name || 'Unknown error'}`);
    if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
      trace.end(traceId, 'generateAudioWithTimeout - Timed out');
      throw new Error(`Request timed out after ${timeoutSeconds} seconds`);
    }
    
    // Handle other errors
    const errorMessage = error.response 
      ? `API error: ${error.response.status} - ${JSON.stringify(error.response.data)}` 
      : error.message;
    
    trace.end(traceId, 'generateAudioWithTimeout - Failed');
    throw new Error(`Audio generation failed: ${errorMessage}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Helper function to format bytes to human-readable format
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// New function to handle batch audio generation
async function generateAudioBatch(lines, startIndex, batchSize, openaiApiKey, timeoutSeconds = 60) {
  const traceId = trace.start(`generateAudioBatch (batch: ${startIndex}-${Math.min(startIndex + batchSize, lines.length) - 1})`);
  const batchEnd = Math.min(startIndex + batchSize, lines.length);
  const batchPromises = [];
  const results = new Array(batchEnd - startIndex).fill(null);
  
  console.log(`[${new Date().toISOString()}] Processing batch from index ${startIndex} to ${batchEnd-1}`);
  
  for (let i = startIndex; i < batchEnd; i++) {
    const lineIndex = i - startIndex; // relative index within batch
    const line = lines[i];
    const cleanedLine = line.replace(/^(Alice|Bob):?\s*/i, '').trim();
    const isAlice = line.match(/^Alice:?/i);
    const voice = isAlice ? "alloy" : "onyx";
    
    console.log(`Queuing audio generation for line ${i + 1}/${lines.length}: "${cleanedLine.substring(0, 50)}..." with voice: ${voice}`);
    
    // Create a promise for each line in the batch
    const promise = (async (index, text, voiceType, isAliceVoice) => {
      let retryCount = 0;
      const maxRetries = 2;
      let buffer = null;
      
      while (retryCount <= maxRetries && !buffer) {
        try {
          buffer = await generateAudioWithTimeout(
            text,
            voiceType,
            openaiApiKey,
            timeoutSeconds
          );
          // Store the result in the correct position
          results[index] = {
            buffer,
            voice: voiceType,
            isAlice: isAliceVoice,
            error: null
          };
          return true;
        } catch (isolatedError) {
          retryCount++;
          console.error(`Isolated process error for line ${i + 1} (attempt ${retryCount}/${maxRetries + 1}):`, isolatedError.message);
          
          if (retryCount > maxRetries) {
            // All retries failed, store the error
            results[index] = {
              buffer: null,
              voice: voiceType,
              isAlice: isAliceVoice,
              error: isolatedError
            };
            return false;
          }
          
          // Wait a bit before retrying
          const retryDelay = 2000 * retryCount; // Exponential backoff
          console.log(`Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    })(lineIndex, cleanedLine, voice, isAlice);
    
    batchPromises.push(promise);
  }
  
  trace.checkpoint(`Started ${batchPromises.length} audio generation tasks`);
  
  // Wait for all operations to complete
  await Promise.all(batchPromises);
  
  trace.checkpoint(`Completed all ${batchPromises.length} audio generation tasks`);
  
  // Calculate combined size
  let totalBytes = 0;
  let successCount = 0;
  let errorCount = 0;
  
  for (const result of results) {
    if (result && result.buffer) {
      totalBytes += result.buffer.length;
      successCount++;
    } else if (result && result.error) {
      errorCount++;
    }
  }
  
  const successRate = (successCount / results.length) * 100;
  console.log(`Batch completion: ${successCount}/${results.length} successful (${successRate.toFixed(1)}%), total size: ${formatBytes(totalBytes)}`);
  
  trace.end(traceId, `generateAudioBatch (success: ${successCount}/${results.length}, ${formatBytes(totalBytes)})`);
  
  return {
    results,
    startIndex,
    endIndex: batchEnd - 1
  };
}

// Main function handler for GCP Cloud Functions
functions.http('processPodcastAudio', async (req, res) => {
  let supabaseAdmin = null;
  let jobId = null;
  
  // Track execution time
  const startTime = Date.now();
  
  // Create a rate limiter for OpenAI API calls
  const openaiRateLimiter = new RateLimiter({
    maxRequestsPerMinute: 50,      // Conservative limits to prevent hitting OpenAI's rate limits
    maxTokensPerMinute: 80000,     // Conservative token limit (80K/min)
    logLevel: 'info'               // Set to 'debug' for more detailed logs
  });
  
  // Set up variables to track state for heartbeat logging
  let currentState = 'initializing';
  let currentStep = 'startup';
  let progressDetails = {};
  
  // Start main process tracing
  const mainProcessId = trace.start('processPodcastAudio');
  
  // Near the beginning of your main function
  const watchdog = startWatchdog(120000, 30000); // 2 min stuck threshold, 30 sec check interval
  
  // Master timeout for the entire function (30 minutes)
  const masterTimeoutId = setTimeout(() => {
    console.error(`[MASTER TIMEOUT] Function execution exceeded 30 minutes, forcing exit`);
    
    // Try to log final state to the database before exiting
    try {
      if (supabaseAdmin && jobId) {
        // We're using a sync version here since we're in a timeout handler
        updateJobStatus(supabaseAdmin, jobId, 'timeout', {
          error: 'Function execution timed out after 30 minutes',
          last_state: currentState,
          last_step: currentStep,
          processing_completed_at: new Date().toISOString()
        }).catch(e => console.error('Failed to update job status on timeout', e));
        
        logProcessingEvent(supabaseAdmin, jobId, 'processing_timeout', 
          'Function execution timed out after 30 minutes', 
          { last_state: currentState, last_step: currentStep }
        ).catch(e => console.error('Failed to log timeout event', e));
      }
    } catch (e) {
      console.error('Failed to update job status or log event on timeout', e);
    }
    
    // End tracing
    trace.end(mainProcessId, 'processPodcastAudio - Timed out');
    
    // Force exit with error code after a short delay to allow logs to flush
    setTimeout(() => process.exit(1), 2000);
  }, 30 * 60 * 1000); // 30 minutes in milliseconds
  
  // Set up a heartbeat interval (log every 30 seconds)
  const heartbeatInterval = setInterval(() => {
    console.log(`[HEARTBEAT ${new Date().toISOString()}] Function still running. State: ${currentState}, Step: ${currentStep}`, progressDetails);
  }, 30000); // Log every 30 seconds

  try {
    // Start monitoring memory usage
    logMemoryUsage('Function Start');
    
    // Log request received
    console.log("Podcast audio processor function called");
    trace.checkpoint('Request received and validated');
    
    // Get the request data
    const { articles, jobId: requestJobId, userId, authToken } = req.body;
    jobId = requestJobId; // Store jobId in the outer scope for error handling
    
    updateProgress('request_parsing', { articleCount: articles?.length, jobId, userId });
    
    console.log("Received articles:", JSON.stringify(articles, null, 2));
    console.log("Job ID:", jobId);
    console.log("User ID:", userId);
    
    // Validate request data
    if (!articles || !Array.isArray(articles)) {
      console.error("Invalid articles format:", articles);
      trace.end(mainProcessId, 'processPodcastAudio - Invalid articles format');
      return res.status(400).json({ error: "Articles must be an array", success: false });
    }

    if (articles.length === 0) {
      console.error("Empty articles array");
      trace.end(mainProcessId, 'processPodcastAudio - Empty articles array');
      return res.status(400).json({ error: "At least one article is required", success: false });
    }

    if (!jobId) {
      console.error("Missing job ID");
      trace.end(mainProcessId, 'processPodcastAudio - Missing job ID');
      return res.status(400).json({ error: "Job ID is required", success: false });
    }

    if (!userId) {
      console.error("Missing user ID");
      trace.end(mainProcessId, 'processPodcastAudio - Missing user ID');
      return res.status(400).json({ error: "User ID is required", success: false });
    }

    if (!authToken) {
      console.error("Missing auth token");
      trace.end(mainProcessId, 'processPodcastAudio - Missing auth token');
      return res.status(400).json({ error: "Auth token is required", success: false });
    }

    // Validate article structure
    articles.forEach((article, index) => {
      if (!article.id) {
        throw new Error(`Article at index ${index} is missing an id`);
      }
      if (!article.title) {
        throw new Error(`Article at index ${index} is missing a title`);
      }
      if (!article.content && !article.summary) {
        throw new Error(`Article at index ${index} is missing both content and summary`);
      }
    });

    console.log("Articles validated");
    logMemoryUsage('After Article Validation');
    currentState = 'accessing_secrets';
    currentStep = 'initialization';
    console.log("Accessing secrets...");

    // Get secrets from Secret Manager
    const [openaiApiKey, supabaseUrl, supabaseServiceKey] = await Promise.all([
      accessSecret('openai_api_key'),
      accessSecret('supabase-url'),
      accessSecret('supabase-service-key')
    ]);

    console.log("Finished accessing secrets")
    currentState = 'initializing_clients';
    // Update progress for watchdog
    updateProgress('initializing_clients', { stage: 'setup' });

    // Initialize OpenAI with the API key
    const openai = new OpenAI({ apiKey: openaiApiKey });

    console.log("Creating Supabase client")

    // Initialize Supabase client with service key for admin operations
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Initialize Supabase client with user's auth token for user-specific operations
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    });

    // Send immediate response to prevent Supabase Edge Function timeout
    res.status(200).json({ 
      success: true, 
      message: 'Podcast processing started',
      job_id: jobId
    });

    // Update job status to processing
    currentState = 'processing';
    currentStep = 'starting';
    await updateJobStatus(supabaseAdmin, jobId, 'processing', {
      processing_started_at: new Date().toISOString()
    });
    
    // Update progress for watchdog
    updateProgress('processing_started', { 
      jobId, 
      articlesCount: articles.length, 
      startTime: new Date().toISOString() 
    });
    
    // Log processing start
    await logProcessingEvent(supabaseAdmin, jobId, 'processing_started', 'Started processing podcast audio');
    logMemoryUsage('Before Processing');

    // Process all articles in one go without chunking
    console.log(`Processing ${articles.length} articles in one go`);

    // Create reusable template sections to reduce repetition
    const mainDiscussionTemplate = `Create a focused discussion about this specific article that will last for at least 3.5 minutes:
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

    const toneStyleTemplate = `Tone and Style:
  - Conversational and engaging, as if speaking directly to the listener.
  - Use inclusive language to foster a sense of community.
  - Incorporate light humor or personal anecdotes where appropriate to humanize the discussion.`;

    const guidelinesTemplate = `Additional Guidelines:
  - Ensure a balanced exchange between both hosts, allowing each to contribute equally.
  - Use clear and concise language, avoiding jargon unless it's explained.
  - Aim for smooth transitions between topics to maintain listener interest.
  - IMPORTANT: DO NOT use terms like "Segment 1" or "Section 2" in the actual dialogue.
  - Consider the use of rhetorical questions to engage the audience and provoke thought.
  - ALWAYS refer to the hosts by their actual names (Alice and Bob), not as "Host 1" or "Host 2".`;

    const formatTemplate = `Format it like a real dialogue:
Alice: ...
Bob: ...
Alice: ...
Bob: ...
Continue this structure with natural conversation flow.`;

    // Get all article titles for the introduction
    const allArticleTitles = articles.map(article => article.title);
    
    console.log("Generating introduction...");
    
    // Start generating content
    currentState = 'generating_content';
    currentStep = 'script_generation';
    
    // Update progress for watchdog
    updateProgress('generating_content', { 
      stage: 'script_generation',
      articles: articles.length 
    });
    
    // Generate introduction using rate limiter
    currentState = 'generating_content';
    currentStep = 'introduction';
    progressDetails = { phase: 'introduction' };
    
    // Create introduction prompt
    const introPrompt = `You are two podcast hosts, Alice and Bob.

Create ONLY the introduction section for a podcast where two hosts engage in a dynamic 
and informative conversation about multiple articles. The introduction should be approximately 1 minute long.

Here are the titles of all articles that will be discussed:
${allArticleTitles.join('\n')}

The introduction should include:
- Alice greeting listeners and introducing Bob.
- Brief overview of the episode's topic and its relevance.
- Mention that today you'll be discussing ALL of these topics: ${allArticleTitles.join(', ')}
- Create excitement about the full range of articles being covered in this episode.
- Indicate that this will be a longer, in-depth episode with substantial time devoted to each topic.

DO NOT start discussing any specific article yet - this is ONLY the introduction.

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}`;

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
    
    const introResponse = await openaiRateLimiter.executeRequest(
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
    logMemoryUsage('After Introduction Generation');
    
    // Generate discussion for each article
    console.log("Generating discussions for each article...");
    
    const articleScripts = [];
    
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      currentStep = `article_${i + 1}`;
      progressDetails = { 
        phase: 'article_discussions', 
        current: i + 1, 
        total: articles.length,
        title: article.title.substring(0, 30) + (article.title.length > 30 ? '...' : '')
      };
      console.log(`Generating discussion for article ${i + 1}: ${article.title}`);
      
      // Create prompt for this specific article
      const articlePrompt = `You are two podcast hosts, Alice and Bob.

You are in the middle of a podcast episode where you're discussing multiple articles.
You've already introduced the podcast and now need to create a focused discussion about this specific article:

Title: ${article.title}
${article.summary || article.content}

${mainDiscussionTemplate}

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

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}`;

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
      
      const articleResponse = await openaiRateLimiter.executeRequest(
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
      
      // Log memory usage after each article generation
      logMemoryUsage(`After Article ${i + 1} Generation`);
      
      // Log rate limiter status
      console.log(`Rate limiter status after article ${i + 1}:`, openaiRateLimiter.getStatus());
    }
    
    console.log("Generating conclusion...");
    currentStep = 'conclusion';
    progressDetails = { phase: 'conclusion' };
    
    // Create conclusion prompt
    const conclusionPrompt = `You are two podcast hosts, Alice and Bob.

Create ONLY the conclusion section for a podcast where you've just finished discussing these articles:
${allArticleTitles.join('\n')}

The conclusion should be approximately 1 minute long and include:
- Hosts summarizing key takeaways from the discussions.
- Encouragement for listeners to reflect on the topics or engage further.
- Thanking the audience for listening and mentioning any future episodes.

This is ONLY the conclusion - assume all articles have already been thoroughly discussed.

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}`;

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
    
    const conclusionResponse = await openaiRateLimiter.executeRequest(
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
    logMemoryUsage('After Conclusion Generation');
    
    // Combine all scripts for the articles
    console.log("Assembling final script...");
    currentState = 'assembling_script';
    currentStep = 'script_assembly';
    
    // Update progress for watchdog
    updateProgress('assembling_script', { 
      stage: 'script_assembly',
      articlesSummaries: articleScripts.length 
    });
    
    const script = [
      introScript,
      ...articleScripts,
      conclusionScript
    ].join('\n\n');

    // Save the generated script to the database
    await updateJobStatus(supabaseAdmin, jobId, 'script_generated', {
      script: script,
      script_status: 'completed'
    });
    
    // Log script generation completion
    await logProcessingEvent(supabaseAdmin, jobId, 'script_generated', 'Generated podcast script');
    logMemoryUsage('After Script Generation');

    // Parse script into lines for each speaker
    const lines = script.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => line.trim())
      .filter(line => line.match(/^(Alice|Bob):?/i)); // Only keep lines with Alice or Bob prefixes

    // Generate audio for each line in order, with proper voice assignment
    console.log("Generating audio for speakers...");
    console.log(`Total lines to process: ${lines.length}`);
    const audioPromises = [];
    const audioMetadata = []; // Keep track of which voice was used for each segment
    let cumulativeAudioBufferSize = 0;

    // Log rate limiter status before audio generation
    console.log("Rate limiter status before audio generation:", openaiRateLimiter.getStatus());

    // Define batch processing parameters
    const BATCH_SIZE = 5; // Process 5 lines at a time
    
    // Process in batches
    for (let batchStart = 0; batchStart < lines.length; batchStart += BATCH_SIZE) {
      // Update progress for heartbeat at batch level
      progressDetails.current_line = batchStart + 1;
      progressDetails.progress_percent = Math.round(((batchStart + 1) / lines.length) * 100);
      
      // Process this batch
      console.log(`[${new Date().toISOString()}] Starting batch processing from line ${batchStart + 1}`);
      
      // Update progress for watchdog
      updateProgress('generating_audio', { 
        batch: batchStart, 
        totalBatches: Math.ceil(lines.length / BATCH_SIZE),
        progress: Math.round((batchStart / lines.length) * 100) + '%',
        currentLine: batchStart + 1,
        totalLines: lines.length
      });
      
      const batchResult = await generateAudioBatch(
        lines, 
        batchStart, 
        BATCH_SIZE,
        openaiApiKey,
        60 // 60 second timeout
      );
      
      // Process the results of this batch
      for (let i = 0; i < batchResult.results.length; i++) {
        const lineResult = batchResult.results[i];
        const actualIndex = batchStart + i;
        
        if (lineResult && lineResult.buffer) {
          // Add to our array of buffers and metadata
          audioPromises.push(lineResult.buffer);
          audioMetadata.push({ 
            isAlice: lineResult.isAlice, 
            voice: lineResult.voice 
          });
          
          // Track buffer size
          cumulativeAudioBufferSize += lineResult.buffer.length;
          
          console.log(`[${new Date().toISOString()}] Successfully added audio for line ${actualIndex + 1}`);
        } else if (lineResult && lineResult.error) {
          console.error(`Error generating audio for line ${actualIndex + 1}/${lines.length}`, lineResult.error);
          
          // Log the error to the database
          await logProcessingEvent(supabaseAdmin, jobId, 'audio_generation_error', 
            `Error generating audio for line ${actualIndex + 1}/${lines.length}`, 
            { error: lineResult.error.message });
            
          // Create a small empty buffer as a placeholder for the failed segment
          // This allows the process to continue rather than failing completely
          console.log(`Using silent placeholder for failed line ${actualIndex + 1}`);
          const silentBuffer = Buffer.alloc(1000); // Small buffer of silence
          audioPromises.push(silentBuffer);
          audioMetadata.push({ 
            isAlice: lineResult.isAlice, 
            voice: lineResult.voice 
          });
          cumulativeAudioBufferSize += silentBuffer.length;
        }
      }
      
      // Update progress after processing the batch
      progressDetails.current_line = Math.min(batchStart + BATCH_SIZE, lines.length);
      progressDetails.progress_percent = Math.round(((progressDetails.current_line) / lines.length) * 100);
      
      // Log progress after batch
      const currentLine = Math.min(batchStart + BATCH_SIZE, lines.length);
      console.log(`Progress: ${currentLine}/${lines.length} lines processed (${Math.round(currentLine / lines.length * 100)}%)`);
      logMemoryUsage(`After ${currentLine} Audio Segments`);
      logBufferSizes(audioPromises, `Audio Buffer after ${currentLine} segments`);
      console.log(`Cumulative audio buffer size: ${(cumulativeAudioBufferSize / 1048576).toFixed(2)} MB`);
      console.log("Rate limiter status:", openaiRateLimiter.getStatus());
    }

    console.log(`Generated ${audioPromises.length} audio segments with alternating voices`);
    logMemoryUsage('After All Audio Generation');
    logBufferSizes(audioPromises, 'Final Audio Segments');

    // Log rate limiter status after audio generation
    console.log("Rate limiter status after audio generation:", openaiRateLimiter.getStatus());
    
    // Log audio generation completion
    await logProcessingEvent(supabaseAdmin, jobId, 'audio_generated', 'Generated all audio segments', {
      audioSegments: audioPromises.length,
      totalAudioSize: `${(cumulativeAudioBufferSize / 1048576).toFixed(2)} MB`,
      averageSegmentSize: `${(cumulativeAudioBufferSize / audioPromises.length / 1024).toFixed(2)} KB`
    });

    console.log(`[${new Date().toISOString()}] All audio segments generated. Combining audio.`);
    currentState = 'combining_audio';
    currentStep = 'audio_combination';
    
    // Update progress for watchdog
    updateProgress('combining_audio', { 
      segments: audioPromises.length,
      totalSegments: lines.length,
      totalSizeMB: (cumulativeAudioBufferSize / 1048576).toFixed(2)
    });

    // Combine all audio buffers
    console.log("Combining audio buffers...");
    const totalLength = audioPromises.reduce((acc, buf) => acc + buf.length, 0);
    console.log(`Total audio size: ${(totalLength / 1048576).toFixed(2)} MB (${totalLength} bytes)`);
    
    // Log memory before buffer allocation
    logMemoryUsage('Before Buffer Allocation');
    
    // Allocate buffer for combined audio
    console.log(`Allocating buffer of ${(totalLength / 1048576).toFixed(2)} MB`);
    const combinedBuffer = Buffer.alloc(totalLength);
    
    // Log memory after buffer allocation
    logMemoryUsage('After Buffer Allocation');
    
    let offset = 0;
    let segmentsTotalSize = 0;
    
    for (let i = 0; i < audioPromises.length; i++) {
      const buffer = audioPromises[i];
      buffer.copy(combinedBuffer, offset);
      offset += buffer.length;
      segmentsTotalSize += buffer.length;
      
      // Log which speaker and voice was used
      console.log(`Added segment ${i+1}: ${audioMetadata[i].isAlice ? 'Alice (alloy)' : 'Bob (onyx)'}, Length: ${buffer.length} bytes`);
      
      // Log memory usage periodically
      if ((i + 1) % 10 === 0 || i === audioPromises.length - 1) {
        const percentComplete = Math.round((i + 1) / audioPromises.length * 100);
        console.log(`Combined ${i + 1}/${audioPromises.length} segments (${percentComplete}%)`);
        console.log(`Current offset: ${offset} bytes (${(offset / 1048576).toFixed(2)} MB)`);
        logMemoryUsage(`After Combining ${i + 1} Audio Segments`);
      }
    }
    
    // Verify the combined buffer is complete
    console.log(`Combined buffer size verification: ${combinedBuffer.length} bytes (expected ${totalLength} bytes)`);
    console.log(`Segments total size: ${segmentsTotalSize} bytes (${(segmentsTotalSize / 1048576).toFixed(2)} MB)`);
    
    // Release individual audio buffers to free memory
    console.log('Releasing individual audio segment buffers...');
    for (let i = 0; i < audioPromises.length; i++) {
      audioPromises[i] = null;
    }
    
    // Force garbage collection if possible (Node.js doesn't expose this directly)
    if (global.gc) {
      console.log('Forcing garbage collection...');
      global.gc();
    } else {
      console.log('Garbage collection not available. Run with --expose-gc to enable.');
    }
    
    // Check memory after freeing individual buffers
    logMemoryUsage('After Freeing Individual Buffers');

    // Log audio combination completion
    await logProcessingEvent(supabaseAdmin, jobId, 'audio_combined', 'Combined all audio segments', {
      totalSegments: audioPromises.length,
      combinedSize: `${(combinedBuffer.length / 1048576).toFixed(2)} MB`,
      combinedSizeBytes: combinedBuffer.length
    });

    // Generate a unique ID for the audio file
    const filenameID = crypto.randomUUID();
    const fileName = `public/${filenameID}.mp3`;

    // Log upload attempt details
    console.log('Attempting file upload:', {
      fileName,
      bucket: 'audio-files',
      contentType: 'audio/mp3',
      bufferSize: `${(combinedBuffer.length / 1048576).toFixed(2)} MB`,
      bufferSizeBytes: combinedBuffer.length
    });
    currentState = 'uploading';
    currentStep = 'file_upload';
    progressDetails = { 
      phase: 'upload',
      file_size_mb: (combinedBuffer.length / 1048576).toFixed(2),
      file_name: fileName
    };
    
    // Update progress for watchdog
    updateProgress('uploading', { 
      phase: 'upload',
      file_size_mb: (combinedBuffer.length / 1048576).toFixed(2),
      file_name: fileName
    });
    logMemoryUsage('Before File Upload');

    // Function to attempt upload with retry
    const attemptUpload = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          // Upload the combined audio to Supabase storage
          console.log(`Upload attempt ${i + 1} of ${retries}...`);
          const uploadTraceId = trace.start(`Upload attempt ${i + 1} of ${retries}`);
          trace.checkpoint(`Initiating storage upload for file: ${fileName} (${formatBytes(combinedBuffer.length)})`);
          
          const { data, error } = await supabaseAdmin.storage
            .from('audio-files')
            .upload(fileName, combinedBuffer, {
              contentType: 'audio/mp3',
              upsert: false
            });

          if (error) {
            trace.checkpoint(`Upload failed with error: ${error.message}`);
            console.error(`Upload attempt ${i + 1} failed:`, {
              message: error.message,
              details: error.details,
              status: error.status,
              fileName,
              attempt: i + 1
            });
            
            // Log the error to the database
            await logProcessingEvent(supabaseAdmin, jobId, 'upload_error', 
              `Upload attempt ${i + 1} failed: ${error.message}`, 
              { details: error.details, status: error.status });
              
            trace.end(uploadTraceId, `Upload attempt ${i + 1} - Failed`);
            if (i === retries - 1) throw error;
          } else {
            trace.checkpoint(`Upload succeeded, response received`);
            console.log('Upload successful:', data);
            trace.end(uploadTraceId, `Upload attempt ${i + 1} - Succeeded`);
            return data;
          }
        } catch (err) {
          trace.checkpoint(`Upload caught exception: ${err.message}`);
          if (i === retries - 1) throw err;
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    };

    // Attempt upload with retry logic
    try {
      await attemptUpload();
    } catch (uploadError) {
      console.error('All upload attempts failed:', {
        message: uploadError.message,
        details: uploadError.details,
        status: uploadError.status,
        fileName
      });
      
      // Update job status to failed
      await updateJobStatus(supabaseAdmin, jobId, 'failed', {
        processing_completed_at: new Date().toISOString()
      });
      
      // Log the error to the database
      await logProcessingEvent(supabaseAdmin, jobId, 'processing_failed', 
        'All upload attempts failed', 
        { error: uploadError.message, details: uploadError.details });
        
      return res.status(500).json({ 
        error: 'Failed to upload audio file', 
        details: uploadError.message,
        success: false 
      });
    }

    // Get the public URL for the uploaded file
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('audio-files')
      .getPublicUrl(fileName);
    console.log(`File public URL: ${publicUrl}`);

    // Log file upload completion
    await logProcessingEvent(supabaseAdmin, jobId, 'file_uploaded', 'Uploaded audio file to storage', 
      { file_url: publicUrl });
    logMemoryUsage('After File Upload');
    
    // Update progress for watchdog - database updates
    updateProgress('updating_database', { 
      phase: 'database',
      file_url: publicUrl
    });

    // Create entry in audio_files table
    const audioFileData = {
      file_url: publicUrl,
      created_at: new Date().toISOString(),
      user_id: userId
    };

    console.log("Attempting to insert audio file entry:", audioFileData);

    const { data: audioFile, error: audioFileError } = await supabaseAdmin
      .from('audio_files')
      .insert(audioFileData)
      .select()
      .single();

    if (audioFileError) {
      console.error('Error inserting audio file entry:', {
        message: audioFileError.message,
        details: audioFileError.details,
        hint: audioFileError.hint,
        status: audioFileError.status
      });
      
      // Update job status to failed
      await updateJobStatus(supabaseAdmin, jobId, 'failed', {
        processing_completed_at: new Date().toISOString()
      });
      
      // Log the error to the database
      await logProcessingEvent(supabaseAdmin, jobId, 'database_error', 
        'Error inserting audio file entry', 
        { error: audioFileError.message, details: audioFileError.details });
        
      return res.status(500).json({ 
        error: 'Failed to insert audio file entry', 
        details: audioFileError.message,
        success: false 
      });
    }

    console.log("Successfully inserted audio file entry");

    // Create entries in article_audio table
    const articleAudioEntries = articles.map(article => ({
      article_id: article.id,
      audio_id: audioFile.id,
      user_id: userId
    }));

    console.log("Attempting to insert article audio map entries: ", articleAudioEntries);

    const { error: articleAudioError } = await supabaseAdmin
      .from('article_audio')
      .insert(articleAudioEntries);

    if (articleAudioError) {
      console.error('Error inserting article audio map entries:', {
        message: articleAudioError.message,
        details: articleAudioError.details,
        hint: articleAudioError.hint,
        status: articleAudioError.status
      });
      
      // Update job status to failed
      await updateJobStatus(supabaseAdmin, jobId, 'failed', {
        processing_completed_at: new Date().toISOString()
      });
      
      // Log the error to the database
      await logProcessingEvent(supabaseAdmin, jobId, 'database_error', 
        'Error inserting article audio map entries', 
        { error: articleAudioError.message, details: articleAudioError.details });
        
      return res.status(500).json({ 
        error: 'Failed to insert article audio map entries', 
        details: articleAudioError.message,
        success: false 
      });
    }

    console.log("Successfully inserted article audio map entries");

    // Update job status to completed
    currentState = 'completed';
    currentStep = 'finalization';
    progressDetails = { 
      phase: 'complete',
      file_url: publicUrl,
      duration_ms: Date.now() - startTime
    };
    
    trace.checkpoint('Processing completed successfully, updating job status');
    
    // Update progress for watchdog - completed
    updateProgress('completed', { 
      duration_ms: Date.now() - startTime,
      file_url: publicUrl,
      total_lines: lines.length,
      total_size_mb: (combinedBuffer.length / 1048576).toFixed(2)
    });
    
    await updateJobStatus(supabaseAdmin, jobId, 'completed', {
      audio_url: publicUrl,
      processing_completed_at: new Date().toISOString()
    });
    
    // Log completion
    await logProcessingEvent(supabaseAdmin, jobId, 'processing_completed', 'Podcast processing completed', {
      audio_url: publicUrl,
      total_duration_ms: Date.now() - startTime
    });
    logMemoryUsage('Function Complete');

    // At the end of your function
    watchdog.stop();

    // At the end of your function or when handling errors
    const summary = trace.summary();
    // This will log the top 5 longest operations and return all timing data
    
    // End the main process trace
    trace.end(mainProcessId, 'processPodcastAudio - Completed Successfully');

    // Return success response
    return res.status(200).json({ 
      audio_file_id: audioFile.id,
      audio_url: publicUrl,
      job_id: jobId,
      success: true 
    });
  } catch (error) {
    console.error("Error processing podcast:", error);
    trace.checkpoint(`Error encountered: ${error.message}`);
    
    // Update progress to show error
    updateProgress('error', { 
      error: error.message,
      stack: error.stack,
      currentState,
      currentStep
    });
    
    // Update the job status to failed if we have a job ID and Supabase client
    if (jobId && supabaseAdmin) {
      try {
        await updateJobStatus(supabaseAdmin, jobId, 'failed', {
          error: error.message,
          processing_completed_at: new Date().toISOString()
        });
        
        // Log the error to the database
        await logProcessingEvent(supabaseAdmin, jobId, 'processing_failed', 
          'Error processing podcast', { error: error.message });
      } catch (dbError) {
        console.error("Failed to log error to database:", dbError);
        trace.checkpoint(`Failed to log error to database: ${dbError.message}`);
      }
    }
    
    // Only send error response if we haven't already responded
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        error: error.message,
        job_id: jobId
      });
    }
    
    trace.end(mainProcessId, `processPodcastAudio - Failed: ${error.message}`);
  } finally {
    // Clean up heartbeat and timeout resources regardless of success or failure
    clearInterval(heartbeatInterval);
    clearTimeout(masterTimeoutId);
    
    // Stop the watchdog
    watchdog.stop();
    
    // Generate trace summary
    const traceSummary = trace.summary();
    console.log(`[${new Date().toISOString()}] Function execution completed or terminated`);
    
    // End tracing if not already ended (in case of success path)
    if (mainProcessId && trace.points.some(p => p.id === mainProcessId && p.status === 'started')) {
      trace.end(mainProcessId, 'processPodcastAudio - Completed');
    }
  }
});

// Helper function to update job status
async function updateJobStatus(supabaseClient, jobId, status, additionalData = {}) {
  const { error } = await supabaseClient
    .from('podcast_jobs')
    .update({
      status: status,
      updated_at: new Date().toISOString(),
      ...additionalData
    })
    .eq('id', jobId);
    
  if (error) {
    console.error(`Error updating job status to ${status}:`, error);
    throw error;
  }
  
  console.log(`Updated job ${jobId} status to ${status}`);
}

// Helper function to log processing events
async function logProcessingEvent(supabaseClient, jobId, eventType, message, details = {}) {
  const { error } = await supabaseClient
    .from('processing_logs')
    .insert({
      job_id: jobId,
      event_type: eventType,
      message: message,
      details: details,
      timestamp: new Date().toISOString()
    });
    
  if (error) {
    console.error(`Error logging processing event ${eventType}:`, error);
    // Don't throw here, just log the error
  } else {
    console.log(`Logged processing event: ${eventType} - ${message}`);
  }
}

/**
 * Comprehensive tracing system to track execution flow and timing
 */
const trace = {
  points: [],
  start: (operation) => {
    const id = Date.now();
    console.log(`[TRACE:START][${id}] ${operation}`);
    trace.points.push({ id, operation, status: 'started', timestamp: new Date().toISOString() });
    return id;
  },
  end: (id, operation) => {
    console.log(`[TRACE:END][${id}] ${operation} - Duration: ${Date.now() - id}ms`);
    trace.points.push({ id, operation, status: 'completed', timestamp: new Date().toISOString() });
  },
  checkpoint: (name) => {
    console.log(`[TRACE:CHECKPOINT] ${name} at ${new Date().toISOString()}`);
    trace.points.push({ name, status: 'checkpoint', timestamp: new Date().toISOString() });
  },
  summary: () => {
    console.log(`[TRACE:SUMMARY] ${trace.points.length} trace points collected`);
    
    // Calculate durations for completed operations
    const completedOperations = [];
    const startPoints = trace.points.filter(p => p.status === 'started');
    
    for (const startPoint of startPoints) {
      const endPoint = trace.points.find(p => 
        p.status === 'completed' && 
        p.id === startPoint.id && 
        p.operation === startPoint.operation
      );
      
      if (endPoint) {
        const startTime = new Date(startPoint.timestamp).getTime();
        const endTime = new Date(endPoint.timestamp).getTime();
        const duration = endTime - startTime;
        
        completedOperations.push({
          operation: startPoint.operation,
          duration,
          startTimestamp: startPoint.timestamp,
          endTimestamp: endPoint.timestamp
        });
      }
    }
    
    // Sort by duration (longest first)
    completedOperations.sort((a, b) => b.duration - a.duration);
    
    console.log('[TRACE:TIMING_SUMMARY] Top 5 longest operations:');
    for (let i = 0; i < Math.min(5, completedOperations.length); i++) {
      const op = completedOperations[i];
      console.log(`  ${i+1}. ${op.operation}: ${op.duration}ms`);
    }
    
    return {
      points: trace.points,
      completedOperations
    };
  }
};

/**
 * Watchdog to detect when the function is stuck
 */
let lastProgress = { stage: 'init', timestamp: Date.now() };
let watchdogInterval = null;

const updateProgress = (stage, details = {}) => {
  lastProgress = { stage, timestamp: Date.now(), details };
  console.log(`[PROGRESS] ${stage}`, details);
  
  // Also add as a trace checkpoint
  trace.checkpoint(`Progress: ${stage}`);
};

const startWatchdog = (stuckThresholdMs = 120000, checkIntervalMs = 30000) => {
  // Clear any existing watchdog
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
  }
  
  console.log(`[WATCHDOG] Starting with check interval ${checkIntervalMs}ms, stuck threshold ${stuckThresholdMs}ms`);
  
  watchdogInterval = setInterval(() => {
    const now = Date.now();
    const sinceLastProgress = now - lastProgress.timestamp;
    
    if (sinceLastProgress > stuckThresholdMs) { // Default: 2 minutes without progress
      console.error(`[WATCHDOG] Function appears stuck in stage '${lastProgress.stage}' for ${Math.floor(sinceLastProgress/1000)}s`);
      console.error('[WATCHDOG] Last progress details:', lastProgress.details);
      
      // Force log of current memory usage
      logMemoryUsage('WATCHDOG');
      
      // You could implement recovery logic here
      // or force the function to return a partial result
    } else {
      console.log(`[WATCHDOG] Function active - last progress ${Math.floor(sinceLastProgress/1000)}s ago in stage '${lastProgress.stage}'`);
    }
  }, checkIntervalMs);
  
  return {
    stop: () => {
      if (watchdogInterval) {
        clearInterval(watchdogInterval);
        watchdogInterval = null;
        console.log('[WATCHDOG] Stopped');
      }
    },
    forceCheck: () => {
      const now = Date.now();
      const sinceLastProgress = now - lastProgress.timestamp;
      console.log(`[WATCHDOG:FORCE_CHECK] Last progress ${Math.floor(sinceLastProgress/1000)}s ago in stage '${lastProgress.stage}'`);
    }
  };
};

// Export these functions to make them available throughout the codebase
module.exports = {
  // ... existing exports
  trace,
  updateProgress,
  startWatchdog
}; 