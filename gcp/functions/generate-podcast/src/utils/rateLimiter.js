// Add utility for memory monitoring
const process = require('process');
const { logMemoryUsage } = require('./logging');

/**
 * Rate Limiter Implementation for OpenAI APIs
 * Manages request rate and token consumption to prevent hitting API limits
 */
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

module.exports = RateLimiter; 