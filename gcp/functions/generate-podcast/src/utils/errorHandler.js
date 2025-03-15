/**
 * Unified error handling system for podcast generation
 */
const { v4: uuidv4 } = require('uuid');

// Error classification constants
const ERROR_TYPES = {
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  API_ERROR: 'api_error',
  RATE_LIMIT: 'rate_limit',
  MEMORY: 'memory',
  UNKNOWN: 'unknown'
};

// Circuit breaker states
const CIRCUIT_STATE = {
  CLOSED: 'closed',    // Normal operation - requests pass through
  OPEN: 'open',        // Circuit is open - fail fast without making requests
  HALF_OPEN: 'half_open' // Testing if service is healthy again
};

// Circuit breaker configuration for different operations
const circuitBreakers = {
  // Audio generation circuit breaker
  audioGeneration: {
    state: CIRCUIT_STATE.CLOSED,
    failureCount: 0,
    lastFailureTime: null,
    failureThreshold: 5,        // Number of failures before opening circuit
    resetTimeout: 30000,        // Time before attempting to half-open (30s)
    successThreshold: 2         // Successful requests needed to close circuit again
  }
};

/**
 * Classify error based on error message and properties
 * @param {Error} error - The error to classify
 * @returns {string} The classified error type
 */
function classifyError(error) {
  const errorMessage = error.message || '';
  const errorName = error.name || '';
  const errorCode = error.code || '';
  
  // Check for network-related errors
  if (
    errorMessage.includes('ECONNRESET') ||
    errorMessage.includes('socket hang up') ||
    errorMessage.includes('socket disconnected') ||
    errorMessage.includes('network') ||
    errorCode === 'ENOTFOUND' ||
    errorCode === 'ECONNREFUSED' ||
    errorCode === 'ECONNRESET' ||
    errorCode === 'ETIMEDOUT'
  ) {
    return ERROR_TYPES.NETWORK;
  }
  
  // Check for timeout errors
  if (
    errorName === 'AbortError' ||
    errorCode === 'ECONNABORTED' ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('timed out')
  ) {
    return ERROR_TYPES.TIMEOUT;
  }
  
  // Check for API-specific errors
  if (
    (error.response && error.response.status) ||
    errorMessage.includes('API') ||
    errorMessage.includes('OpenAI')
  ) {
    // Check for rate limit errors
    if (
      (error.response && error.response.status === 429) ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests')
    ) {
      return ERROR_TYPES.RATE_LIMIT;
    }
    
    return ERROR_TYPES.API_ERROR;
  }
  
  // Check for memory-related errors
  if (
    errorMessage.includes('memory') ||
    errorMessage.includes('heap') ||
    errorMessage.includes('allocation')
  ) {
    return ERROR_TYPES.MEMORY;
  }
  
  // Default to unknown error type
  return ERROR_TYPES.UNKNOWN;
}

/**
 * Enrich error with additional context and correlation ID
 * @param {Error} error - The original error
 * @param {Object} context - Additional context for the error
 * @returns {Object} Enhanced error object with context
 */
function enrichError(error, context = {}) {
  const errorType = classifyError(error);
  const correlationId = context.correlationId || uuidv4();
  
  // Create an enriched error object
  const enrichedError = {
    original: error,
    message: error.message,
    type: errorType,
    correlationId,
    timestamp: new Date().toISOString(),
    context: {
      ...context,
      stack: error.stack
    }
  };
  
  // Add HTTP response details if available
  if (error.response) {
    enrichedError.status = error.response.status;
    enrichedError.statusText = error.response.statusText;
    enrichedError.data = error.response.data;
  }
  
  return enrichedError;
}

/**
 * Check if the circuit breaker allows operation
 * @param {string} operationType - Type of operation (e.g., 'audioGeneration')
 * @returns {boolean} Whether the operation is allowed
 */
function isCircuitClosed(operationType) {
  const circuitBreaker = circuitBreakers[operationType];
  
  if (!circuitBreaker) {
    return true; // No circuit breaker configured, always allow
  }
  
  if (circuitBreaker.state === CIRCUIT_STATE.CLOSED) {
    return true; // Circuit is closed, allow operation
  }
  
  if (circuitBreaker.state === CIRCUIT_STATE.OPEN) {
    // Check if it's time to try again
    const now = Date.now();
    if (circuitBreaker.lastFailureTime && (now - circuitBreaker.lastFailureTime) > circuitBreaker.resetTimeout) {
      // Transition to half-open state
      circuitBreaker.state = CIRCUIT_STATE.HALF_OPEN;
      console.log(`Circuit for ${operationType} transitioned to HALF_OPEN state`);
      return true; // Allow one test operation
    }
    return false; // Circuit is open, fail fast
  }
  
  if (circuitBreaker.state === CIRCUIT_STATE.HALF_OPEN) {
    // In half-open state, we're testing if the service is healthy
    // Only allow limited operations
    return true;
  }
  
  return true; // Default to allowing the operation
}

/**
 * Record success for circuit breaker
 * @param {string} operationType - Type of operation (e.g., 'audioGeneration')
 */
function recordSuccess(operationType) {
  const circuitBreaker = circuitBreakers[operationType];
  
  if (!circuitBreaker) {
    return; // No circuit breaker configured
  }
  
  if (circuitBreaker.state === CIRCUIT_STATE.HALF_OPEN) {
    // In half-open state, we're counting successes to determine if we should close the circuit
    circuitBreaker.failureCount = 0; // Reset failure count on first success
    circuitBreaker.successCount = (circuitBreaker.successCount || 0) + 1;
    
    if (circuitBreaker.successCount >= circuitBreaker.successThreshold) {
      // Enough successes, close the circuit
      circuitBreaker.state = CIRCUIT_STATE.CLOSED;
      circuitBreaker.successCount = 0;
      console.log(`Circuit for ${operationType} closed after successful operations`);
    }
  }
}

/**
 * Record failure for circuit breaker
 * @param {string} operationType - Type of operation (e.g., 'audioGeneration')
 * @param {Object} error - The error that occurred
 */
function recordFailure(operationType, error) {
  const circuitBreaker = circuitBreakers[operationType];
  
  if (!circuitBreaker) {
    return; // No circuit breaker configured
  }
  
  circuitBreaker.failureCount++;
  circuitBreaker.lastFailureTime = Date.now();
  
  if (circuitBreaker.state === CIRCUIT_STATE.HALF_OPEN) {
    // Any failure in half-open state immediately opens the circuit again
    circuitBreaker.state = CIRCUIT_STATE.OPEN;
    circuitBreaker.successCount = 0;
    console.log(`Circuit for ${operationType} reopened after failure in half-open state: ${error.message}`);
    return;
  }
  
  if (circuitBreaker.state === CIRCUIT_STATE.CLOSED && circuitBreaker.failureCount >= circuitBreaker.failureThreshold) {
    // Too many failures, open the circuit
    circuitBreaker.state = CIRCUIT_STATE.OPEN;
    console.log(`Circuit for ${operationType} opened after ${circuitBreaker.failureCount} failures. Last error: ${error.message}`);
  }
}

/**
 * Log enhanced error information
 * @param {Object} enrichedError - Error that has been enriched with context
 */
function logEnhancedError(enrichedError) {
  // Log error with its full context
  console.error(`[ERROR][${enrichedError.correlationId}][${enrichedError.type}] ${enrichedError.message}`, {
    errorType: enrichedError.type,
    correlationId: enrichedError.correlationId,
    timestamp: enrichedError.timestamp,
    context: enrichedError.context
  });
  
  // Add more specific logging based on error type
  switch (enrichedError.type) {
    case ERROR_TYPES.NETWORK:
      console.error(`[NETWORK ERROR] Network issue detected: ${enrichedError.message}`);
      break;
    case ERROR_TYPES.TIMEOUT:
      console.error(`[TIMEOUT ERROR] Operation timed out: ${enrichedError.message}`);
      break;
    case ERROR_TYPES.RATE_LIMIT:
      console.error(`[RATE LIMIT ERROR] Rate limit hit: ${enrichedError.message}`);
      break;
    case ERROR_TYPES.MEMORY:
      console.error(`[MEMORY ERROR] Memory issue detected: ${enrichedError.message}`);
      break;
  }
}

/**
 * Get circuit breaker status
 * @param {string} operationType - Type of operation
 * @returns {Object} Current status of the circuit breaker
 */
function getCircuitStatus(operationType) {
  const circuitBreaker = circuitBreakers[operationType];
  
  if (!circuitBreaker) {
    return { exists: false };
  }
  
  return {
    exists: true,
    state: circuitBreaker.state,
    failureCount: circuitBreaker.failureCount,
    lastFailureTime: circuitBreaker.lastFailureTime,
    threshold: circuitBreaker.failureThreshold,
    resetTimeout: circuitBreaker.resetTimeout
  };
}

module.exports = {
  ERROR_TYPES,
  CIRCUIT_STATE,
  classifyError,
  enrichError,
  isCircuitClosed,
  recordSuccess,
  recordFailure,
  logEnhancedError,
  getCircuitStatus
}; 