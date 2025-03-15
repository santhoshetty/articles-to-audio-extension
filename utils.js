/**
 * Utility functions for podcast generation
 */

/**
 * Execute a function with a timeout
 * @param {Function} fn - Function to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {AbortSignal} [signal] - Optional AbortSignal to cancel the operation
 * @returns {Promise<any>} Result of the function
 */
async function executeWithTimeout(fn, timeoutMs, signal = null) {
  // Create a timeout promise that rejects after the specified timeout
  const timeoutPromise = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`Operation timed out after ${timeoutMs/1000} seconds`));
    }, timeoutMs);
    
    // If signal is provided, listen for abort events
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        reject(new Error('Operation was cancelled'));
      }, { once: true });
    }
  });
  
  return Promise.race([fn(), timeoutPromise]);
}

/**
 * Log memory usage
 * @param {string} label - Label for the log
 */
function logMemoryUsage(label) {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const memUsage = process.memoryUsage();
    console.log(`Memory Usage (${label}):
    RSS: ${formatBytes(memUsage.rss)} (Resident Set Size)
    Heap Total: ${formatBytes(memUsage.heapTotal)}
    Heap Used: ${formatBytes(memUsage.heapUsed)}
    External: ${formatBytes(memUsage.external)}
    ArrayBuffers: ${formatBytes(memUsage.arrayBuffers || 0)}`);
  } else {
    console.log(`Memory usage logging not available`);
  }
}

/**
 * Format bytes to human-readable format
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted bytes
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Estimate audio duration based on file size
 * @param {number} sizeInBytes - Audio file size in bytes
 * @returns {number} Estimated duration in seconds
 */
function estimateAudioDuration(sizeInBytes) {
  // Rough estimate: MP3 at ~128 kbps is about 16 KB per second
  return Math.round(sizeInBytes / (16 * 1024));
}

/**
 * Format duration in seconds to MM:SS format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export {
  executeWithTimeout,
  logMemoryUsage,
  formatBytes,
  estimateAudioDuration,
  formatDuration
}; 