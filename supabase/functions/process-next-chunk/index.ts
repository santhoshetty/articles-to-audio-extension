import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { OpenAI } from "https://esm.sh/openai@4.28.0"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

// Add rate limiting with a simple token bucket implementation
const rateLimiter = {
  tokens: 50, // Start with 50 tokens
  maxTokens: 50, // Maximum number of tokens
  refillRate: 1, // Tokens to add per second
  lastRefillTime: Date.now(), // Last time tokens were refilled
  refill() {
    const now = Date.now();
    const timePassed = (now - this.lastRefillTime) / 1000; // Convert to seconds
    const tokensToAdd = Math.floor(timePassed * this.refillRate);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
    
    return this.tokens;
  },
  consume(tokens = 1) {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  },
  async waitForTokens(tokens = 1) {
    while (!this.consume(tokens)) {
      console.log(`Rate limiting in effect, waiting for tokens (current: ${this.tokens})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.refill();
    }
  }
};

// Add chunk processing state tracking
const processingState = new Map();

serve(async (req) => {
  try {
    // Log request received
    console.log("Process next chunk function called")
    
    // Get the job ID and next chunk index from the request body
    const { jobId, nextChunkIndex, retryCount = 0 } = await req.json()
    
    if (!jobId) {
      console.error("Missing job ID")
      throw new Error("Job ID is required")
    }

    if (nextChunkIndex === undefined) {
      console.error("Missing next chunk index")
      throw new Error("Next chunk index is required")
    }

    // Check if this chunk is already being processed to avoid duplicates
    const chunkKey = `${jobId}-${nextChunkIndex}`;
    if (processingState.has(chunkKey)) {
      console.log(`Chunk ${nextChunkIndex} for job ${jobId} is already being processed, skipping`);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Chunk ${nextChunkIndex} for job ${jobId} is already being processed`
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Mark this chunk as being processed
    processingState.set(chunkKey, Date.now());

    // Initialize OpenAI with the API key from edge function secrets
    const apiKey = Deno.env.get('openai_api_key')
    if (!apiKey) {
      console.error("OpenAI API key not found in environment")
      throw new Error("OpenAI API key not configured")
    }

    const openai = new OpenAI({ apiKey })

    // Get Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase configuration")
      throw new Error("Supabase configuration is incomplete")
    }

    // Use service role for this function since it's called from another edge function
    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceKey
    )

    // Check if this chunk has already been processed successfully
    const { data: existingChunk, error: existingChunkError } = await supabaseAdmin
      .from('podcast_chunks')
      .select('status')
      .eq('job_id', jobId)
      .eq('chunk_index', nextChunkIndex)
      .single()

    if (!existingChunkError && existingChunk && existingChunk.status === 'completed') {
      console.log(`Chunk ${nextChunkIndex} for job ${jobId} is already completed, moving to next chunk`);
      processingState.delete(chunkKey);
      
      // Move to next chunk processing
      await triggerNextChunkProcessing(supabaseAdmin, supabaseUrl, supabaseServiceKey, jobId, nextChunkIndex);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: `Chunk ${nextChunkIndex} was already completed`
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Get the chunk text and job info
    const { data: chunkData, error: chunkError } = await supabaseAdmin
      .from('podcast_chunks')
      .select('chunk_text, job_id')
      .eq('job_id', jobId)
      .eq('chunk_index', nextChunkIndex)
      .single()

    if (chunkError || !chunkData) {
      console.error(`Error fetching chunk ${nextChunkIndex}:`, chunkError)
      processingState.delete(chunkKey);
      throw new Error(`Failed to get chunk data: ${chunkError?.message || "Chunk not found"}`)
    }

    // Get user ID from the job
    const { data: jobData, error: jobError } = await supabaseAdmin
      .from('podcast_jobs')
      .select('user_id, status')
      .eq('id', jobId)
      .single()

    if (jobError || !jobData) {
      console.error("Error fetching job:", jobError)
      processingState.delete(chunkKey);
      throw new Error(`Failed to get job data: ${jobError?.message || "Job not found"}`)
    }

    // If job is already marked as error and we're not retrying, skip processing
    if (jobData.status === 'error' && retryCount === 0) {
      console.log(`Job ${jobId} is already marked as error and not in retry mode, skipping chunk ${nextChunkIndex}`);
      processingState.delete(chunkKey);
      return new Response(
        JSON.stringify({
          success: false,
          message: `Job ${jobId} is in error state, skipping chunk ${nextChunkIndex}`
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const userId = jobData.user_id

    // Update chunk status to processing
    await supabaseAdmin
      .from('podcast_chunks')
      .update({
        status: 'processing',
        error: null // Clear previous errors if retrying
      })
      .eq('job_id', jobId)
      .eq('chunk_index', nextChunkIndex)

    console.log(`Processing chunk ${nextChunkIndex} for job ${jobId}...`)

    try {
      // Clean the input text - ensure newlines are properly handled
      const cleanedText = chunkData.chunk_text.replace(/\\n/g, "\n").trim()
      
      // Remove the filter for lines starting with ***
      const filteredText = cleanedText
        // Remove any content between [square brackets]
        .split('\n')
        .map(line => line.replace(/\[.*?\]/g, '')) // This line removes content in square brackets
        .join('\n')
      
      // Split the cleaned text into speaker segments
      const segments = []
      const lines = filteredText.split('\n')
      
      let currentSpeaker = null
      let currentSegment = ""
      
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue
        
        // Check if this is a new speaker
        const aliceMatch = trimmedLine.match(/^Alice:/)
        const bobMatch = trimmedLine.match(/^Bob:/)
        
        if (aliceMatch || bobMatch) {
          // If we have a previous segment, push it
          if (currentSegment && currentSpeaker) {
            segments.push({
              text: currentSegment.trim(),
              speaker: currentSpeaker
            })
          }
          
          // Start a new segment
          currentSpeaker = aliceMatch ? "Alice" : "Bob"
          currentSegment = trimmedLine
        } else if (currentSpeaker) {
          // Continue current segment
          currentSegment += " " + trimmedLine
        }
      }
      
      // Add the last segment if exists
      if (currentSegment && currentSpeaker) {
        segments.push({
          text: currentSegment.trim(),
          speaker: currentSpeaker
        })
      }
      
      console.log(`Split chunk ${nextChunkIndex} into ${segments.length} speaker segments`)
      
      // Generate audio for each segment
      const audioBuffers = []
      const audioMetadata = [] // Keep track of which voice was used for each segment
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        // Clean the segment text by removing the speaker prefix
        const cleanedSegmentText = segment.text.replace(/^(Alice|Bob):\s*/i, "").trim()
          // Additional cleaning to remove any remaining stage directions or annotations
          .replace(/\[.*?\]/g, '') // Remove any remaining text in square brackets
          .replace(/\*\*\*.*?\*\*\*/g, '') // Remove any text between *** markers
          .trim()
        
        if (cleanedSegmentText.length === 0) continue
        
        // Check if segment is within TTS limit
        if (cleanedSegmentText.length > 4000) {
          console.warn(`Segment ${i} for speaker ${segment.speaker} exceeds 4000 characters (${cleanedSegmentText.length}), truncating`)
          // Truncate to stay under limits
          segment.text = cleanedSegmentText.substring(0, 3900) + "..."
        }
        
        // Select the appropriate voice based on speaker
        const voice = segment.speaker === "Alice" ? "alloy" : "onyx"
        
        console.log(`Generating audio for ${segment.speaker} segment ${i} with voice ${voice} (${cleanedSegmentText.length} chars)`)
        
        // Wait for rate limiting tokens before making API calls
        await rateLimiter.waitForTokens(2); // Consume 2 tokens per segment
        
        // Implement retry logic for audio generation with exponential backoff
        let retryCount = 0
        const maxRetries = 3 // Increased from 2 to 3
        let success = false
        let error = null
        
        while (!success && retryCount <= maxRetries) {
          try {
            if (retryCount > 0) {
              console.log(`Retry ${retryCount}/${maxRetries} for segment ${i}`)
              // Exponential backoff
              const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 10000); // Max 10 seconds
              await new Promise(resolve => setTimeout(resolve, backoffTime));
              
              // Ensure we have rate limiting tokens before retrying
              await rateLimiter.waitForTokens(2);
            }
            
            // Add a safety check for problematic content
            const safeText = cleanedSegmentText
              .replace(/[^\x20-\x7E\s]/g, "") // Remove non-printable ASCII characters
              .replace(/(\r\n|\n|\r)/gm, " ") // Replace newlines with spaces
              .replace(/\s+/g, " ") // Replace multiple spaces with single space
              .replace(/[""]/g, "\"") // Replace smart quotes with straight quotes
              .replace(/['']/g, "'") // Replace smart apostrophes with straight ones
              .replace(/[–—]/g, "-") // Replace em/en dashes with hyphens
              .replace(/[…]/g, "...") // Replace ellipsis character with periods
              .replace(/&/g, " and ") // Replace ampersands
              .trim()

            // Log safeText length and a small preview for debugging
            console.log(`Segment ${i} text length: ${safeText.length}, Preview: "${safeText.substring(0, 50)}${safeText.length > 50 ? '...' : ''}"`)
            
            // Split very long segments into smaller pieces
            // Use a more aggressive splitting strategy for long texts
            const maxSegmentLength = 2000; // Reduce from 3000 to 2000 for more reliability
            
            if (safeText.length > maxSegmentLength) {
              const textParts = splitTextIntoChunks(safeText, maxSegmentLength);
              console.log(`Split long segment ${i} into ${textParts.length} parts`);
              
              for (let partIndex = 0; partIndex < textParts.length; partIndex++) {
                const part = textParts[partIndex];
                
                // Wait for rate limiting tokens before each API call
                if (partIndex > 0) {
                  await rateLimiter.waitForTokens(1);
                }
                
                const speechResponse = await openai.audio.speech.create({
                  model: "tts-1",
                  voice: voice,
                  input: part,
                });
                
                try {
                  const audioBuffer = await speechResponse.arrayBuffer();
                  console.log(`Successfully decoded audio response for part ${partIndex+1} of segment ${i}, size: ${audioBuffer.byteLength} bytes`);
                  audioBuffers.push(audioBuffer);
                  audioMetadata.push({ speaker: segment.speaker, voice });
                } catch (decodeError) {
                  console.error(`Error decoding audio response for part ${partIndex+1} of segment ${i}:`, decodeError);
                  throw new Error(`Failed to decode audio response: ${decodeError.message}`);
                }
              }
            } else {
              // Normal processing for standard-length segments
              const speechResponse = await openai.audio.speech.create({
                model: "tts-1",
                voice: voice,
                input: safeText,
              });
              
              try {
                const audioBuffer = await speechResponse.arrayBuffer();
                console.log(`Successfully decoded audio response for segment ${i}, size: ${audioBuffer.byteLength} bytes`);
                audioBuffers.push(audioBuffer);
                audioMetadata.push({ speaker: segment.speaker, voice });
              } catch (decodeError) {
                console.error(`Error decoding audio response for segment ${i}:`, decodeError);
                throw new Error(`Failed to decode audio response: ${decodeError.message}`);
              }
            }
            
            success = true;
            
          } catch (err) {
            error = err;
            console.error(`Error generating audio for segment ${i} (attempt ${retryCount+1}):`, err);
            
            // Check if this is a rate limit error
            const isRateLimit = err.message?.includes('rate limit') || 
                               err.message?.includes('too many requests') ||
                               err.status === 429;
            
            if (isRateLimit) {
              console.log('Rate limit detected, enforcing longer cooldown');
              // Add more delay for rate limit errors (5-15 seconds)
              await new Promise(resolve => setTimeout(resolve, 5000 + (Math.random() * 10000)));
              // Reduce token count to slow down
              rateLimiter.tokens = Math.max(0, rateLimiter.tokens - 10);
            }
            
            // Log the full segment text for debugging purposes
            console.log(`Full text of segment ${i} that caused the error:`)
            console.log('---------------------- BEGIN SEGMENT TEXT ----------------------')
            console.log(cleanedSegmentText)
            console.log('----------------------- END SEGMENT TEXT -----------------------')
            
            // Also log the sanitized text that was actually sent to the API
            console.log(`Sanitized text sent to API:`)
            console.log('------------------- BEGIN SANITIZED TEXT ----------------------')
            console.log(safeText)
            console.log('-------------------- END SANITIZED TEXT -----------------------')
            
            retryCount++
          }
        }
        
        // If we couldn't generate audio after retries, but we have some audio already,
        // we'll continue with what we have rather than failing the entire chunk
        if (!success && audioBuffers.length > 0) {
          console.warn(`Failed to generate audio for segment ${i} after ${maxRetries} retries, but continuing with ${audioBuffers.length} segments`)
        } else if (!success) {
          // More detailed error reporting
          let errorMsg = `Failed to generate audio for segment ${i} after ${maxRetries} retries`;
          if (error) {
            errorMsg += `: ${error.message || "Unknown error"}`;
            // Log more details about the error if available
            console.error(`Detailed error info for segment ${i}:`, {
              message: error.message,
              name: error.name,
              stack: error.stack,
            });
          }
          throw new Error(errorMsg);
        }
      }
      
      console.log(`Generated ${audioBuffers.length} audio segments for chunk ${nextChunkIndex}`)
      
      // Combine all audio segments into a single buffer
      if (audioBuffers.length === 0) {
        throw new Error("No audio segments were generated for this chunk")
      }
      
      // For now, we'll use a simple concatenation approach
      // In a more sophisticated implementation, we could use ffmpeg for better audio stitching
      const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.byteLength, 0)
      const combinedBuffer = new Uint8Array(totalLength)
      
      let offset = 0
      for (let i = 0; i < audioBuffers.length; i++) {
        const buffer = audioBuffers[i]
        combinedBuffer.set(new Uint8Array(buffer), offset)
        offset += buffer.byteLength
        
        // Log which speaker and voice was used
        console.log(`Added segment ${i+1}: ${audioMetadata[i].speaker} (${audioMetadata[i].voice}), Length: ${buffer.byteLength} bytes`)
      }
      
      // Store the combined audio file
      const filePath = `chunks/${userId}/${jobId}/chunk_${nextChunkIndex}.mp3`
      
      // Upload with retry logic to ensure storage reliability
      let uploadAttempts = 0;
      let uploadSuccess = false;
      let publicUrl = '';
      
      while (uploadAttempts < 3 && !uploadSuccess) {
        uploadAttempts++;
        try {
          const { error: uploadError } = await supabaseAdmin
            .storage
            .from('audio-files')
            .upload(filePath, combinedBuffer, {
              contentType: 'audio/mpeg',
              cacheControl: '3600',
              upsert: true // Use upsert to avoid conflicts
            });
            
          if (uploadError) {
            console.error(`Upload attempt ${uploadAttempts} failed: ${uploadError.message}`);
            if (uploadAttempts < 3) {
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            throw new Error(`Failed to upload combined audio after ${uploadAttempts} attempts: ${uploadError.message}`);
          }
          
          // Verify the file was uploaded by checking if it exists
          const { data: fileExists, error: fileCheckError } = await supabaseAdmin
            .storage
            .from('audio-files')
            .list(`chunks/${userId}/${jobId}`);
            
          if (fileCheckError || !fileExists || !fileExists.some(file => file.name === `chunk_${nextChunkIndex}.mp3`)) {
            console.error(`File verification failed after upload attempt ${uploadAttempts}`);
            if (uploadAttempts < 3) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            throw new Error('File verification failed after upload');
          }
          
          // Get the public URL for the uploaded file
          const { data: urlData } = supabaseAdmin
            .storage
            .from('audio-files')
            .getPublicUrl(filePath);
            
          publicUrl = urlData.publicUrl;
          uploadSuccess = true;
          console.log(`Successfully uploaded and verified audio file for chunk ${nextChunkIndex}`);
        } catch (error) {
          console.error(`Unexpected error during upload attempt ${uploadAttempts}:`, error);
          if (uploadAttempts === 3) {
            throw error;
          }
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (!uploadSuccess) {
        throw new Error(`Failed to upload audio file for chunk ${nextChunkIndex} after multiple attempts`);
      }

      // Use a transaction to ensure atomic updates to the database
      console.log(`Incrementing completed_chunks for job ${jobId} with chunk ${nextChunkIndex}...`);
      const { data: transactionData, error: transactionError } = await supabaseAdmin.rpc('update_chunk_and_increment', {
        p_job_id: jobId,
        p_chunk_index: nextChunkIndex,
        p_audio_url: publicUrl
      });
      
      if (transactionError) {
        console.error(`Error in transaction for chunk ${nextChunkIndex}:`, transactionError);
        throw new Error(`Database transaction failed: ${transactionError.message}`);
      }

      // Verify and log the incremented state
      const { data: verifyJobData, error: verifyJobError } = await supabaseAdmin
        .from('podcast_jobs')
        .select('total_chunks, completed_chunks')
        .eq('id', jobId)
        .single();
        
      if (!verifyJobError && verifyJobData) {
        console.log(`Chunk ${nextChunkIndex} processed. Job state: ${verifyJobData.completed_chunks}/${verifyJobData.total_chunks} chunks completed`);
        
        // Sanity check - completed shouldn't exceed total
        if (verifyJobData.completed_chunks > verifyJobData.total_chunks) {
          console.error(`WARNING: Job ${jobId} has more completed chunks (${verifyJobData.completed_chunks}) than total chunks (${verifyJobData.total_chunks})`);
          
          // Attempt to fix the inconsistency
          try {
            const { data: reconcileResult, error: reconcileError } = await supabaseAdmin
              .rpc('audit_and_reconcile_podcast_job', { p_job_id: jobId });
              
            if (reconcileError) {
              console.error(`Error reconciling job after inconsistency: ${reconcileError.message}`);
            } else {
              console.log(`Reconciliation result after inconsistency:`, reconcileResult);
            }
          } catch (reconcileErr) {
            console.error(`Exception during reconciliation: ${reconcileErr.message}`);
          }
        }
      } else {
        console.log(`Could not verify job state after processing: ${verifyJobError?.message}`);
      }

      console.log(`Chunk ${nextChunkIndex} processed successfully with ${audioBuffers.length} segments`);
      
      // Release the processing lock
      processingState.delete(chunkKey);

      // Trigger next chunk processing
      await triggerNextChunkProcessing(supabaseAdmin, supabaseUrl, supabaseServiceKey, jobId, nextChunkIndex);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Successfully processed chunk ${nextChunkIndex} for job ${jobId}`
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    } catch (error) {
      console.error(`Error processing chunk ${nextChunkIndex}:`, error)
      
      // Release the processing lock
      processingState.delete(chunkKey);
      
      // Update chunk status to error
      await supabaseAdmin
        .from('podcast_chunks')
        .update({
          status: 'error',
          error: error.message
        })
        .eq('job_id', jobId)
        .eq('chunk_index', nextChunkIndex)
      
      // Don't mark the whole job as error immediately, just mark this chunk
      // and allow other chunks to continue processing
      
      // If we haven't reached max retries for this chunk, schedule a retry
      if (retryCount < 2) {
        console.log(`Scheduling retry for chunk ${nextChunkIndex}, attempt ${retryCount + 1}`);
        
        // Schedule a retry after some delay
        setTimeout(async () => {
          try {
            const nextChunkUrl = `${supabaseUrl}/functions/v1/process-next-chunk`;
            
            await fetch(nextChunkUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({
                jobId: jobId,
                nextChunkIndex: nextChunkIndex,
                retryCount: retryCount + 1
              })
            });
          } catch (retryError) {
            console.error(`Failed to schedule retry for chunk ${nextChunkIndex}:`, retryError);
          }
        }, 5000 + (retryCount * 5000)); // Increasing delay between retries
      } else {
        // Also trigger the next chunk even if this one failed after all retries
        console.log(`Chunk ${nextChunkIndex} failed after ${retryCount} retries, moving to next chunk`);
        
        // Move on to the next chunk
        await triggerNextChunkProcessing(supabaseAdmin, supabaseUrl, supabaseServiceKey, jobId, nextChunkIndex);
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: `Error processing chunk ${nextChunkIndex}: ${error.message}`
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }
  } catch (error) {
    console.error("Error in process-next-chunk function:", error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
}) 

// Helper function to split text into smaller chunks at sentence boundaries
function splitTextIntoChunks(text, maxLength = 2000) {
  // If text is already small enough, return it as is
  if (text.length <= maxLength) {
    return [text];
  }
  
  const chunks = [];
  let currentPos = 0;
  
  while (currentPos < text.length) {
    // If the remaining text fits within the limit, add it all
    if (currentPos + maxLength >= text.length) {
      chunks.push(text.substring(currentPos));
      break;
    }
    
    // Try to find a sentence ending within the maxLength
    let endPos = currentPos + maxLength;
    const searchArea = text.substring(currentPos, endPos + 100); // Look a bit beyond max length
    
    // Look for sentence endings (., !, ?)
    const sentenceEndMatch = searchArea.match(/[.!?]\s+/g);
    
    if (sentenceEndMatch) {
      // Find the last sentence ending within our maxLength (or slightly beyond)
      let lastEnd = 0;
      for (const match of sentenceEndMatch) {
        const matchPos = searchArea.indexOf(match, lastEnd);
        if (matchPos <= maxLength) {
          lastEnd = matchPos + match.length;
        } else {
          break;
        }
      }
      
      if (lastEnd > 0) {
        // We found a good sentence ending
        endPos = currentPos + lastEnd;
      } else {
        // If no good sentence ending, try to find a good break at a word boundary
        const nearMaxLength = text.substring(currentPos, currentPos + maxLength);
        const lastSpace = nearMaxLength.lastIndexOf(' ');
        if (lastSpace > maxLength / 2) { // Only use if we're at least halfway through
          endPos = currentPos + lastSpace + 1;
        }
        // Otherwise, we'll just cut at the maxLength
      }
    } else {
      // No sentence breaks found, try to break at a word boundary
      const nearMaxLength = text.substring(currentPos, currentPos + maxLength);
      const lastSpace = nearMaxLength.lastIndexOf(' ');
      if (lastSpace > maxLength / 2) { // Only use if we're at least halfway through
        endPos = currentPos + lastSpace + 1;
      }
      // Otherwise, we'll just cut at the maxLength
    }
    
    chunks.push(text.substring(currentPos, endPos));
    currentPos = endPos;
  }
  
  return chunks;
}

// Helper function to trigger processing of the next chunk
async function triggerNextChunkProcessing(supabaseAdmin, supabaseUrl, supabaseServiceKey, jobId, currentChunkIndex) {
  try {
    // Check if we need to process next chunk
    const { data: updatedJobData, error: jobError } = await supabaseAdmin
      .from('podcast_jobs')
      .select('total_chunks, completed_chunks, status')
      .eq('id', jobId)
      .single();

    if (jobError) {
      console.error(`Error fetching updated job data: ${jobError.message}`);
      return;
    }

    // Get all chunks to check their status directly
    const { data: chunkData, error: chunkError, count } = await supabaseAdmin
      .from('podcast_chunks')
      .select('chunk_index, status', { count: 'exact' })
      .eq('job_id', jobId)
      .order('chunk_index');

    if (chunkError) {
      console.error(`Error fetching chunks: ${chunkError.message}`);
      return;
    }

    // Check if the job seems out of sync
    const completedChunks = chunkData.filter(chunk => chunk.status === 'completed').length;
    if (completedChunks !== updatedJobData.completed_chunks) {
      console.log(`Job ${jobId} appears out of sync: ${completedChunks} completed chunks in DB vs ${updatedJobData.completed_chunks} in job record`);
      
      // Run the reconciliation function
      const { data: reconcileResult, error: reconcileError } = await supabaseAdmin
        .rpc('audit_and_reconcile_podcast_job', { p_job_id: jobId });
        
      if (reconcileError) {
        console.error(`Error reconciling job: ${reconcileError.message}`);
      } else {
        console.log(`Job reconciliation result:`, reconcileResult);
      }
    }

    // Check if we've reached the end of processing
    if (completedChunks >= updatedJobData.total_chunks) {
      console.log(`All chunks are already processed for job ${jobId}`);
      return;
    }

    // Look for any pending chunks, not just the next one in sequence
    const pendingChunks = chunkData.filter(chunk => chunk.status === 'pending');
    const processingChunks = chunkData.filter(chunk => chunk.status === 'processing');
    
    // If we have no pending chunks but some processing chunks, check if any have been stuck for too long
    if (pendingChunks.length === 0 && processingChunks.length > 0) {
      console.log(`Job ${jobId} has no pending chunks but ${processingChunks.length} processing chunks`);
      
      // You would add code here to detect and reset stuck processing chunks
      // This would require adding a timestamp field to track when processing started
    }
    
    if (pendingChunks.length > 0) {
      // Get the next pending chunk - preferring the one after currentChunkIndex, but taking any if needed
      let nextChunk = pendingChunks.find(chunk => chunk.chunk_index === currentChunkIndex + 1);
      
      // If there's no direct next chunk, find the one with the lowest index
      if (!nextChunk) {
        nextChunk = pendingChunks.reduce((lowest, chunk) => 
          !lowest || chunk.chunk_index < lowest.chunk_index ? chunk : lowest, null);
      }
      
      const nextChunkIndex = nextChunk.chunk_index;
      console.log(`Found pending chunk ${nextChunkIndex}, triggering processing`);
      
      // Call this function again for the next chunk
      const nextChunkUrl = `${supabaseUrl}/functions/v1/process-next-chunk`;
      
      // Use a consistent but randomized delay to avoid overwhelming the system
      const delay = 1000 + Math.random() * 2000; // 1-3 seconds random delay
      console.log(`Adding ${delay.toFixed(0)}ms delay before starting next chunk`);
      
      setTimeout(async () => {
        try {
          const response = await fetch(nextChunkUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              jobId: jobId,
              nextChunkIndex: nextChunkIndex
            })
          });
          
          if (!response.ok) {
            const responseData = await response.text();
            console.error(`Error response from next chunk trigger: ${response.status}, ${responseData}`);
            throw new Error(`Failed to trigger next chunk: ${response.status}`);
          }
          
          // Log the response status to help with debugging
          console.log(`Next chunk trigger response status: ${response.status}`);
        } catch (error) {
          console.error(`Error triggering next chunk ${nextChunkIndex}:`, error);
          
          // If we fail to trigger the next chunk, schedule a retry
          setTimeout(() => {
            triggerNextChunkProcessing(supabaseAdmin, supabaseUrl, supabaseServiceKey, jobId, currentChunkIndex);
          }, 5000);
        }
      }, delay);
    } else {
      console.log(`No pending chunks found for job ${jobId}`);
      
      // Final reconciliation to ensure job status matches actual chunk statuses
      const { data: reconcileResult, error: reconcileError } = await supabaseAdmin
        .rpc('audit_and_reconcile_podcast_job', { p_job_id: jobId });
        
      if (reconcileError) {
        console.error(`Error in final reconciliation: ${reconcileError.message}`);
      } else {
        console.log(`Final reconciliation result:`, reconcileResult);
      }
    }
  } catch (error) {
    console.error(`Error checking job status or triggering next chunk:`, error);
    
    // Add failsafe retry to recover from unexpected errors
    setTimeout(() => {
      console.log(`Retrying next chunk processing for job ${jobId} after error`);
      triggerNextChunkProcessing(supabaseAdmin, supabaseUrl, supabaseServiceKey, jobId, currentChunkIndex);
    }, 10000); // Longer delay for error recovery
  }
} 