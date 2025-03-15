/**
 * Audio generation functions for podcast generation
 */

import { combineAudioBlobs } from './openai.js';
import { saveAudio, getSetting } from './db.js';
import { executeWithTimeout, formatBytes, logMemoryUsage } from './utils.js';

/**
 * Generate audio for a podcast script
 * @param {Object} scriptData - Script data from generatePodcastScript
 * @param {Function} progressCallback - Callback for progress updates
 * @param {AbortController} [abortController] - Optional AbortController to cancel the operation
 * @returns {Promise<Object>} Podcast metadata and IDs
 */
async function generatePodcastAudio(scriptData, progressCallback = () => {}, abortController = null) {
  // Use provided abort controller or create a new one
  const controller = abortController || new AbortController();
  const signal = controller.signal;
  
  try {
    const { title, articleIds, script, lines, settings } = scriptData;
    
    // Check if already aborted
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    // Get OpenAI API key
    const openaiApiKey = await getSetting('openai_api_key');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not found in settings');
    }
    
    // Generate audio for all lines
    progressCallback({ stage: 'audio', message: 'Generating audio...', progress: 65 });
    
    // Batch settings
    const batchSize = 5; // Process 5 lines at a time
    const timeoutSeconds = 60;
    
    // Process lines in batches
    const totalLines = lines.length;
    const batches = Math.ceil(totalLines / batchSize);
    
    // Store all audio segments in a single array
    const allAudioSegments = [];
    
    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      // Check for cancellation before each batch
      if (signal.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      const startIdx = batchIndex * batchSize;
      const endIdx = Math.min(startIdx + batchSize, totalLines);
      const currentBatchSize = endIdx - startIdx;
      
      const batchProgressStart = 65 + Math.floor((batchIndex / batches) * 30);
      const batchProgressEnd = 65 + Math.floor(((batchIndex + 1) / batches) * 30);
      
      progressCallback({
        stage: 'audio',
        message: `Generating audio batch ${batchIndex + 1}/${batches}...`,
        progress: batchProgressStart,
        audioProgress: {
          currentLine: startIdx + 1,
          totalLines: totalLines,
          progressPercent: Math.floor((startIdx / totalLines) * 100)
        }
      });

      console.log('Voice Map Settings:', settings.voiceMap);
      
      const batchResult = await generateAudioBatch(
        lines, 
        startIdx, 
        currentBatchSize, 
        openaiApiKey, 
        timeoutSeconds,
        settings.voiceMap,
        controller,
        (progress) => {
          const overallProgress = batchProgressStart + 
            Math.floor((progress.processed / currentBatchSize) * (batchProgressEnd - batchProgressStart));
          
          progressCallback({
            stage: 'audio',
            message: `Generating audio: ${startIdx + progress.processed}/${totalLines}`,
            progress: overallProgress,
            audioProgress: {
              currentLine: startIdx + progress.processed,
              totalLines: totalLines,
              progressPercent: Math.floor(((startIdx + progress.processed) / totalLines) * 100)
            }
          });
        }
      );
      
      // Add all segments from this batch to our collection
      allAudioSegments.push(...batchResult.results);
    }
    
    // Check for cancellation before processing results
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    // Filter out any segments with errors
    const validSegments = allAudioSegments.filter(segment => segment && segment.buffer);
    
    // Check if we have any valid segments
    if (validSegments.length === 0) {
      console.error("No valid audio segments were generated");
      throw new Error("Audio generation failed: No valid audio segments were produced");
    }
    
    // Sort segments by their original position in the script and sequence within each line
    console.log(`Sorting ${validSegments.length} audio segments into correct sequence...`);
    validSegments.sort((a, b) => {
      // First sort by original line index
      if (a.originalLineIndex !== b.originalLineIndex) {
        return a.originalLineIndex - b.originalLineIndex;
      }
      // Then sort by sequence within the line (if available)
      return (a.sequenceIndex || 0) - (b.sequenceIndex || 0);
    });
    
    console.log("Audio segments in sorted order (first 5):");
    validSegments.slice(0, 5).forEach((segment, idx) => {
      console.log(`Segment ${idx}: Line ${segment.originalLineIndex}, ${segment.role}, Text: "${segment.text.substring(0, 30)}..."`);
    });
    
    // Check for cancellation before combining
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    // Extract buffers and metadata
    const validBuffers = validSegments.map(segment => segment.buffer);
    const validMetadata = validSegments.map(segment => ({
      voice: segment.voice,
      role: segment.role,
      text: segment.text
    }));
    
    // Combine audio buffers
    progressCallback({ stage: 'combining', message: 'Combining audio files...', progress: 95 });
    const combinedBuffer = combineAudioBuffers(validBuffers, validMetadata);
    
    // Convert buffer to blob
    const combinedBlob = new Blob([combinedBuffer], { type: 'audio/mp3' });
    
    // Check for cancellation before saving
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    // Save podcast to database
    progressCallback({ stage: 'saving', message: 'Saving podcast...', progress: 98 });
    
    const podcastData = {
      title: title,
      articleIds: articleIds,
      script: script,
      blob: combinedBlob,
      type: 'podcast',
      dateCreated: new Date().toISOString(),
      settings: settings
    };
    
    const podcastId = await saveAudio(podcastData);
    
    // Save individual audio segments if enabled
    if (settings.saveSegments && !signal.aborted) {
      for (let i = 0; i < validSegments.length && !signal.aborted; i++) {
        const segment = validSegments[i];
        const segmentBlob = new Blob([segment.buffer], { type: 'audio/mp3' });
        const segmentData = {
          articleIds: articleIds,
          podcastId: podcastId,
          lineIndex: segment.originalLineIndex,
          sequenceIndex: segment.sequenceIndex || 0,
          speaker: segment.role === 'HOST' ? settings.hostNames['HOST'] : settings.hostNames['CO-HOST'],
          text: segment.text,
          blob: segmentBlob,
          type: 'segment',
          dateCreated: new Date().toISOString()
        };
        
        await saveAudio(segmentData);
      }
    }
    
    // Final cancellation check before completing
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    progressCallback({ stage: 'complete', message: 'Podcast generation complete', progress: 100 });
    
    return {
      podcastId,
      title: title,
      duration: estimateAudioDuration(combinedBlob.size),
      size: combinedBlob.size
    };
  } catch (error) {
    if (signal.aborted) {
      console.log('Podcast audio generation was cancelled');
      progressCallback({ stage: 'cancelled', message: 'Operation cancelled', progress: 0 });
    } else {
      console.error('Error generating podcast audio:', error);
      progressCallback({ stage: 'error', message: error.message, error });
    }
    throw error;
  }
}

/**
 * Generate audio for a batch of lines
 * @param {Array<object>} lines - Lines of text to convert to audio
 * @param {number} startIndex - Starting index in the lines array
 * @param {number} batchSize - Number of lines to process in this batch
 * @param {string} openaiApiKey - OpenAI API key
 * @param {number} timeoutSeconds - Timeout in seconds for each generation
 * @param {object} voiceMap - Mapping of speaker roles to voice IDs
 * @param {AbortController} [abortController] - Optional AbortController to cancel the operation
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Promise<object>} Batch results
 */
async function generateAudioBatch(lines, startIndex, batchSize, openaiApiKey, timeoutSeconds = 60, voiceMap = {}, abortController = null, progressCallback = () => {}) {
  // Use provided abort controller or create a new one
  const controller = abortController || new AbortController();
  const signal = controller.signal;
  
  const batchEnd = Math.min(startIndex + batchSize, lines.length);
  const batchPromises = [];
  const results = [];
  let resultIndex = 0;
  
  console.log(`========================`);
  console.log(`GENERATING AUDIO BATCH:`);
  console.log(`Lines ${startIndex} to ${batchEnd-1}`);
  console.log(`VOICE MAP:`, JSON.stringify(voiceMap, null, 2));
  console.log(`========================`);
  
  // Validate voice map
  if (!voiceMap || !voiceMap['HOST'] || !voiceMap['CO-HOST']) {
    console.error("INVALID VOICE MAP:", voiceMap);
    throw new Error("Invalid voice map configuration. Voice map must contain HOST and CO-HOST keys.");
  }
  
  // Check if already aborted
  if (signal.aborted) {
    throw new Error('Operation was cancelled');
  }
  
  // Track speakers for debugging
  let hostLineCount = 0;
  let cohostLineCount = 0;
  
  // Get the host voice IDs
  const hostVoice = voiceMap['HOST'];
  const cohostVoice = voiceMap['CO-HOST'];

  console.log(`HOST VOICE: ${hostVoice}`);
  console.log(`CO-HOST VOICE: ${cohostVoice}`);
  
  // Define speaker names
  const hostNames = ['HOST', 'Host', 'Hari'];
  const cohostNames = ['CO-HOST', 'Co-host', 'Leela'];
  
  console.log(`Host identifiers:`, hostNames.map(n => n + ':'));
  console.log(`Co-host identifiers:`, cohostNames.map(n => n + ':'));

  for (let i = startIndex; i < batchEnd; i++) {
    // Check for cancellation before processing each line
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    const line = lines[i];
    let text = line.text.trim();
    
    if (!text) {
      console.warn(`Empty text for line ${i}, skipping`);
      continue;
    }
    
    // Fix duplicate name issue - if the line starts with a repeated name like "Hari: Hari:"
    const duplicateNamePattern = /^([^:]+):\s*\1:/;
    if (duplicateNamePattern.test(text)) {
      console.log(`FIXING DUPLICATE NAME in line: "${text}"`);
      text = text.replace(duplicateNamePattern, '$1:');
      console.log(`FIXED to: "${text}"`);
    }
    
    // *** CRITICAL NEW STEP: Split multi-speaker lines into individual turns ***
    const splitLines = splitTextIntoSpeakerTurns(
      text,
      hostNames.map(n => n + ':'),
      cohostNames.map(n => n + ':')
    );
    console.log(`Split line ${i} into ${splitLines.length} speaker turns`);
    
    // Process each speaker turn separately
    for (let turnIndex = 0; turnIndex < splitLines.length; turnIndex++) {
      // Check for cancellation before processing each turn
      if (signal.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      const speakerTurn = splitLines[turnIndex];
      const { speaker, text: turnText } = speakerTurn;
      
      // Skip empty turns
      if (!turnText || turnText.trim() === '') {
        continue;
      }
      
      // Determine voice based on speaker
      let voice, role;
      if (speaker === 'HOST') {
        voice = hostVoice;
        role = 'HOST';
        hostLineCount++;
        console.log(`SPEAKER TURN: HOST - "${turnText.substring(0, 30)}..."`);
      } else if (speaker === 'CO-HOST') {
        voice = cohostVoice;
        role = 'CO-HOST';
        cohostLineCount++;
        console.log(`SPEAKER TURN: CO-HOST - "${turnText.substring(0, 30)}..."`);
      } else {
        // This should never happen with proper splitting
        console.error(`Unknown speaker for turn: "${turnText.substring(0, 30)}..."`);
        continue;
      }
      
      console.log(`Voice assigned: ${voice} for role: ${role}`);
      console.log(`Clean text: "${turnText}"`);
      
      // Create a promise for each speaker turn
      const promise = (async (index, lineText, voiceID, lineRole, origLineIdx, seqIdx) => {
        try {
          // Check for cancellation before generating audio
          if (signal.aborted) {
            throw new Error('Operation was cancelled');
          }
          
          console.log(`Generating audio with voice: ${voiceID} for line: "${lineText.substring(0, 30)}..."`);
          
          const buffer = await generateAudioWithTimeout(
            lineText,
            voiceID,
            openaiApiKey,
            timeoutSeconds,
            signal
          );
          
          // Check for cancellation after generating audio
          if (signal.aborted) {
            throw new Error('Operation was cancelled');
          }
          
          // Store the result with sequence information
          results.push({
            buffer,
            voice: voiceID,
            role: lineRole,
            text: lineText,
            originalLineIndex: origLineIdx,
            sequenceIndex: seqIdx  // Track sequence within the original line
          });
          
          console.log(`Successfully generated audio for turn with ${lineRole} voice (${voiceID})`);
          
          // Report progress
          progressCallback({ processed: index + 1 });
          return true;
        } catch (error) {
          // Check if the operation was cancelled
          if (signal.aborted) {
            console.log(`Audio generation for line was cancelled`);
            throw new Error('Operation was cancelled');
          }
          
          console.error(`Error generating audio: ${error.message}`);
          
          // Store error in results with sequence information
          results.push({
            buffer: null,
            voice: voiceID,
            role: lineRole,
            error: error,
            originalLineIndex: origLineIdx,
            sequenceIndex: seqIdx
          });
          
          progressCallback({ processed: index + 1 });
          return false;
        }
      })(resultIndex++, turnText, voice, role, i, turnIndex);
      
      batchPromises.push(promise);
    }
  }
  
  // Wait for all operations to complete or until cancelled
  try {
    await Promise.all(batchPromises);
  } catch (error) {
    // If operation was cancelled, we can stop here
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }
    // Otherwise, continue with partial results
    console.error('Error during batch processing:', error);
  }
  
  // Check if the operation was cancelled
  if (signal.aborted) {
    throw new Error('Operation was cancelled');
  }
  
  // Summary stats
  console.log(`\nBATCH RESULTS SUMMARY:`);
  console.log(`HOST voice (${hostVoice}) used: ${hostLineCount} times`);
  console.log(`CO-HOST voice (${cohostVoice}) used: ${cohostLineCount} times`);
  console.log(`Total speaker turns processed: ${hostLineCount + cohostLineCount}`);
  
  // Count actual results
  let successCount = 0;
  let errorCount = 0;
  
  for (const result of results) {
    if (result && result.buffer) {
      successCount++;
    } else if (result && result.error) {
      errorCount++;
    }
  }
  
  console.log(`Success: ${successCount}, Errors: ${errorCount}`);
  console.log(`========================\n`);
  
  return {
    results,
    startIndex,
    endIndex: batchEnd - 1
  };
}

/**
 * Generate audio with timeout using a direct API call
 * @param {string} text - Text to convert to speech
 * @param {string} voice - Voice to use (e.g., "alloy", "onyx")
 * @param {string} openaiApiKey - OpenAI API key
 * @param {number} timeoutSeconds - Timeout in seconds
 * @param {AbortSignal} [signal] - Optional AbortSignal to cancel the operation
 * @returns {Promise<Uint8Array>} - Audio buffer
 */
async function generateAudioWithTimeout(text, voice, openaiApiKey, timeoutSeconds = 60, signal = null) {
  if (!text || text.trim() === '') {
    throw new Error("Cannot generate audio for empty text");
  }
  
  if (!voice) {
    throw new Error("Voice ID is required for audio generation");
  }
  
  console.log(`Generating audio with voice=${voice} for text: "${text.substring(0, 30)}..."`);

  // Create an AbortController for timeout if no signal provided
  const localController = signal ? null : new AbortController();
  // Use provided signal or the local controller's signal
  const requestSignal = signal || localController?.signal;
  
  // Set timeout that will abort the request if it takes too long
  const timeoutId = setTimeout(() => {
    if (localController) {
      localController.abort();
    }
  }, timeoutSeconds * 1000);
  
  try {
    // Make a direct request to OpenAI API using fetch
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: voice,
        input: text
      }),
      signal: requestSignal
    });
    
    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = await response.text();
        errorMessage += ` - ${errorData}`;
      } catch (e) {
        // Ignore error parsing error
      }
      throw new Error(errorMessage);
    }
    
    // Get array buffer from response
    const arrayBuffer = await response.arrayBuffer();
    console.log(`Successfully received ${arrayBuffer.byteLength} bytes of audio data`);
    
    // Convert the response to a Uint8Array
    const buffer = new Uint8Array(arrayBuffer);
    return buffer;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (signal && signal.aborted) {
        throw new Error('Operation was cancelled');
      } else {
        throw new Error(`Request timed out after ${timeoutSeconds} seconds`);
      }
    }
    
    // Handle other errors
    throw new Error(`Audio generation failed: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Split text into separate speaker turns
 * @param {string} text - Text that may contain multiple speakers
 * @param {Array<string>} hostIdentifiers - Array of strings that identify the host speaker
 * @param {Array<string>} cohostIdentifiers - Array of strings that identify the co-host speaker
 * @returns {Array<object>} Array of objects with speaker and text information
 */
function splitTextIntoSpeakerTurns(text, hostIdentifiers, cohostIdentifiers) {
  // If the text is empty, return empty array
  if (!text || text.trim() === '') {
    return [];
  }
  
  console.log(`Processing text for speaker turns:`);
  console.log(`Host identifiers:`, hostIdentifiers);
  console.log(`Co-host identifiers:`, cohostIdentifiers);
  
  // Create a pattern that matches any speaker identifier followed by a colon
  const allIdentifiers = [...hostIdentifiers, ...cohostIdentifiers].map(id => 
    id.replace(/:/g, '')  // Remove any colons from the identifiers
  );
  
  // Create a regex pattern that will match "SpeakerName: " including the space after colon
  const speakerPattern = new RegExp(`(${allIdentifiers.join('|')})\\s*:\\s+`, 'g');
  console.log(`Using speaker pattern: ${speakerPattern}`);
  
  // First, try to separate multiple speakers in the same text block
  // Split by new line, dashes, or clear speaker markers
  const segments = text.split(/\n+|---+|\r\n/);
  
  const turns = [];
  
  // Process each segment to find speaker turns
  for (const segment of segments) {
    if (!segment.trim()) continue;
    
    // Find all speaker markers in this segment
    const speakerMarkers = Array.from(segment.matchAll(speakerPattern));
    
    if (speakerMarkers.length === 0) {
      // No clear speaker, use context to determine
      let foundSpeaker = null;
      let segmentText = segment.trim();
      
      // Try to find a speaker name at the beginning of the text
      const prefixMatch = segmentText.match(/^([^:]+):\s*/);
      if (prefixMatch) {
        const possibleSpeaker = prefixMatch[1].trim();
        
        // Check if this is a known host name
        for (const hostId of hostIdentifiers) {
          const cleanHostId = hostId.replace(/:/g, '').trim();
          if (possibleSpeaker.toLowerCase() === cleanHostId.toLowerCase()) {
            foundSpeaker = 'HOST';
            // Remove the speaker prefix for the actual spoken content
            segmentText = segmentText.substring(prefixMatch[0].length).trim();
            console.log(`Found host prefix in segment: ${possibleSpeaker}`);
            break;
          }
        }
        
        // If not a host, check if it's a co-host
        if (!foundSpeaker) {
          for (const cohostId of cohostIdentifiers) {
            const cleanCohostId = cohostId.replace(/:/g, '').trim();
            if (possibleSpeaker.toLowerCase() === cleanCohostId.toLowerCase() || 
                possibleSpeaker.toLowerCase().includes('leela')) {
              foundSpeaker = 'CO-HOST';
              // Remove the speaker prefix for the actual spoken content
              segmentText = segmentText.substring(prefixMatch[0].length).trim();
              console.log(`Found co-host prefix in segment: ${possibleSpeaker}`);
              break;
            }
          }
        }
      }
      
      // If still no speaker, use context to determine
      if (!foundSpeaker) {
        for (const hostId of hostIdentifiers) {
          if (segment.includes(hostId)) {
            foundSpeaker = 'HOST';
            break;
          }
        }
      }
      
      if (!foundSpeaker) {
        for (const cohostId of cohostIdentifiers) {
          if (segment.includes(cohostId)) {
            foundSpeaker = 'CO-HOST';
            break;
          }
        }
      }
      
      // Default to HOST if no speaker found
      turns.push({
        speaker: foundSpeaker || 'HOST',
        text: segmentText
      });
      
      console.log(`Processed segment without clear markers: Speaker=${foundSpeaker || 'HOST'}, Text="${segmentText.substring(0, 30)}..."`);
      continue;
    }
    
    // Use the positions of speaker markers to split the text into turns
    for (let i = 0; i < speakerMarkers.length; i++) {
      const marker = speakerMarkers[i];
      const speakerName = marker[1].trim();
      
      // Determine if this is HOST or CO-HOST
      let speaker = 'HOST';  // Default
      
      // Check explicitly for Leela first (priority detection)
      if (speakerName.toLowerCase().includes('leela')) {
        speaker = 'CO-HOST';
        console.log(`Detected Leela as speaker: ${speakerName}`);
      }
      else {
        // Check if the speaker name is in cohostIdentifiers (removing any colons)
        for (const cohostId of cohostIdentifiers) {
          const cleanCohostId = cohostId.replace(/:/g, '').trim();
          if (speakerName.toLowerCase() === cleanCohostId.toLowerCase()) {
            speaker = 'CO-HOST';
            console.log(`Matched co-host identifier: ${cleanCohostId}`);
            break;
          }
        }
      }
      
      const startPos = marker.index;
      const nextMarker = speakerMarkers[i + 1];
      const endPos = nextMarker ? nextMarker.index : segment.length;
      
      // Extract the text for this turn (including the speaker prefix)
      const turnTextWithPrefix = segment.substring(startPos, endPos).trim();
      
      // Remove the speaker prefix for the actual spoken content
      // Get everything after the first colon and space
      const actualText = turnTextWithPrefix.replace(/^[^:]+:\s*/, '').trim();
      
      // If there's actual content, add it as a turn
      if (actualText) {
        turns.push({
          speaker,
          text: actualText
        });
        
        console.log(`Identified turn: Speaker=${speaker}, Text="${actualText.substring(0, 30)}..."`);
        console.log(`Removed prefix from: "${turnTextWithPrefix.substring(0, Math.min(40, turnTextWithPrefix.length))}..."`);
      }
    }
  }
  
  // If no turns were created but we have text, default to HOST
  if (turns.length === 0 && text.trim() !== '') {
    // Check if the text starts with a speaker name
    const cleanText = text.trim();
    const prefixMatch = cleanText.match(/^([^:]+):\s*/);
    let textWithoutPrefix = cleanText;
    
    if (prefixMatch) {
      // Remove the speaker prefix for the actual spoken content
      textWithoutPrefix = cleanText.substring(prefixMatch[0].length).trim();
      console.log(`Removed prefix in fallback: "${prefixMatch[0]}"`);
    }
    
    turns.push({
      speaker: 'HOST',
      text: textWithoutPrefix
    });
    console.log(`No clear turns found, defaulting to HOST with text: "${textWithoutPrefix.substring(0, 30)}..."`);
  }
  
  console.log(`Split into ${turns.length} turns`);
  return turns;
}

/**
 * Combines multiple audio buffers into a single buffer
 * @param {Array<Uint8Array>} audioBuffers - Array of audio buffers to combine
 * @param {Array<object>} metadata - Metadata for each buffer
 * @returns {Uint8Array} Combined audio buffer
 */
function combineAudioBuffers(audioBuffers, metadata) {
  console.log("Combining audio buffers...");
  
  // Check if we have any buffers to combine
  if (!audioBuffers || audioBuffers.length === 0) {
    console.warn("No audio buffers to combine, returning empty buffer");
    return new Uint8Array(0);
  }
  
  const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.length, 0);
  console.log(`Total audio size: ${formatBytes(totalLength)} (${totalLength} bytes)`);
  console.log(`Total number of segments: ${audioBuffers.length}`);
  
  // Log memory before buffer allocation
  logMemoryUsage('Before Buffer Allocation');
  
  // Allocate buffer for combined audio
  console.log(`Allocating buffer of ${formatBytes(totalLength)}`);
  const combinedBuffer = new Uint8Array(totalLength);
  
  // Log memory after buffer allocation
  logMemoryUsage('After Buffer Allocation');
  
  let offset = 0;
  let segmentsTotalSize = 0;
  
  for (let i = 0; i < audioBuffers.length; i++) {
    const buffer = audioBuffers[i];
    combinedBuffer.set(buffer, offset);
    offset += buffer.length;
    segmentsTotalSize += buffer.length;
    
    // Log which speaker and voice was used
    if (metadata && metadata[i]) {
      console.log(`Added segment ${i+1}: Speaker="${metadata[i].role}", Voice=${metadata[i].voice}, Length: ${buffer.length} bytes`);
      if (i < 5 || i >= audioBuffers.length - 5) { // Show text for first and last few segments
        console.log(`Segment ${i+1} text: "${metadata[i].text.substring(0, 50)}..."`);
      }
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
 * Estimate audio duration based on file size
 * @param {number} sizeInBytes - Audio file size in bytes
 * @returns {number} Estimated duration in seconds
 */
function estimateAudioDuration(sizeInBytes) {
  // Rough estimate: MP3 at ~128 kbps is about 16 KB per second
  return Math.round(sizeInBytes / (16 * 1024));
}

export {
  generatePodcastAudio,
  generateAudioBatch,
  generateAudioWithTimeout,
  splitTextIntoSpeakerTurns,
  combineAudioBuffers,
  estimateAudioDuration
}; 