/**
 * Watchdog to detect when the function is stuck
 */
let lastProgress = { stage: 'init', timestamp: Date.now() };
let watchdogInterval = null;

/**
 * Updates the current progress of the execution
 * @param {string} stage - Current stage of execution
 * @param {object} details - Optional details about the current stage
 */
const updateProgress = (stage, details = {}) => {
  lastProgress = { stage, timestamp: Date.now(), details };
  console.log(`[PROGRESS] ${stage}`, details);
  
  // Add as a trace checkpoint via the imported trace module
  const { trace } = require('./logging');
  trace.checkpoint(`Progress: ${stage}`);
};

/**
 * Starts a watchdog timer to detect when the function is stuck
 * @param {number} stuckThresholdMs - Time in ms after which the function is considered stuck
 * @param {number} checkIntervalMs - Interval in ms to check if the function is stuck
 * @returns {object} Methods to stop and check the watchdog
 */
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
      const { logMemoryUsage } = require('./logging');
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

module.exports = {
  updateProgress,
  startWatchdog
}; 