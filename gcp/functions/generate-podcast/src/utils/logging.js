// Add utility for memory monitoring
const process = require('process');

/**
 * Logs detailed memory usage information
 * @param {string} prefix - Optional prefix for the log message
 */
function logMemoryUsage(prefix = '') {
  const memoryUsage = process.memoryUsage();
  console.log(`${prefix} Memory Usage:`, {
    rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,       // Total memory allocated
    heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`, // Total size of allocated heap
    heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,  // Actual memory used
    external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`   // Memory used by C++ objects
  });
}

/**
 * Logs detailed information about buffer sizes
 * @param {Buffer[]} buffers - Array of buffers to measure
 * @param {string} prefix - Optional prefix for the log message
 * @returns {number} Total size of all buffers in bytes
 */
function logBufferSizes(buffers, prefix = '') {
  if (!buffers || !Array.isArray(buffers)) {
    console.log(`${prefix} Buffer tracking: No buffers to measure`);
    return 0;
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

/**
 * Helper function to format bytes to human-readable format
 * @param {number} bytes - Bytes to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted string
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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

module.exports = {
  logMemoryUsage,
  logBufferSizes,
  formatBytes,
  trace
}; 