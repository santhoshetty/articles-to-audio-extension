const axios = require('axios');
const { trace, formatBytes, logBufferSizes, logMemoryUsage } = require('../utils/logging');

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

/**
 * Generate audio for a batch of lines
 * @param {string[]} lines - Lines of text to convert to audio
 * @param {number} startIndex - Starting index in the lines array
 * @param {number} batchSize - Number of lines to process in this batch
 * @param {string} openaiApiKey - OpenAI API key
 * @param {number} timeoutSeconds - Timeout in seconds for each generation
 * @returns {Promise<object>} Batch results
 */
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

/**
 * Combines multiple audio buffers into a single buffer
 * @param {Array<Buffer>} audioBuffers - Array of audio buffers to combine
 * @param {Array<object>} metadata - Metadata for each buffer
 * @returns {Buffer} Combined audio buffer
 */
function combineAudioBuffers(audioBuffers, metadata) {
  console.log("Combining audio buffers...");
  const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.length, 0);
  console.log(`Total audio size: ${formatBytes(totalLength)} (${totalLength} bytes)`);
  
  // Log memory before buffer allocation
  logMemoryUsage('Before Buffer Allocation');
  
  // Allocate buffer for combined audio
  console.log(`Allocating buffer of ${formatBytes(totalLength)}`);
  const combinedBuffer = Buffer.alloc(totalLength);
  
  // Log memory after buffer allocation
  logMemoryUsage('After Buffer Allocation');
  
  let offset = 0;
  let segmentsTotalSize = 0;
  
  for (let i = 0; i < audioBuffers.length; i++) {
    const buffer = audioBuffers[i];
    buffer.copy(combinedBuffer, offset);
    offset += buffer.length;
    segmentsTotalSize += buffer.length;
    
    // Log which speaker and voice was used
    if (metadata && metadata[i]) {
      console.log(`Added segment ${i+1}: ${metadata[i].isAlice ? 'Alice (alloy)' : 'Bob (onyx)'}, Length: ${buffer.length} bytes`);
    } else {
      console.log(`Added segment ${i+1}, Length: ${buffer.length} bytes`);
    }
    
    // Log memory usage periodically
    if ((i + 1) % 10 === 0 || i === audioBuffers.length - 1) {
      const percentComplete = Math.round((i + 1) / audioBuffers.length * 100);
      console.log(`Combined ${i + 1}/${audioBuffers.length} segments (${percentComplete}%)`);
      console.log(`Current offset: ${offset} bytes (${formatBytes(offset)})`);
      logMemoryUsage(`After Combining ${i + 1} Audio Segments`);
    }
  }
  
  // Verify the combined buffer is complete
  console.log(`Combined buffer size verification: ${combinedBuffer.length} bytes (expected ${totalLength} bytes)`);
  console.log(`Segments total size: ${segmentsTotalSize} bytes (${formatBytes(segmentsTotalSize)})`);
  
  // Check memory after combining buffers
  logMemoryUsage('After Combining All Buffers');
  
  return combinedBuffer;
}

/**
 * Free individual audio buffers to save memory
 * @param {Array<Buffer>} audioBuffers - Array of audio buffers to free
 */
function freeAudioBuffers(audioBuffers) {
  // Release individual audio buffers to free memory
  console.log('Releasing individual audio segment buffers...');
  for (let i = 0; i < audioBuffers.length; i++) {
    audioBuffers[i] = null;
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
}

module.exports = {
  generateAudioWithTimeout,
  generateAudioBatch,
  combineAudioBuffers,
  freeAudioBuffers
}; 