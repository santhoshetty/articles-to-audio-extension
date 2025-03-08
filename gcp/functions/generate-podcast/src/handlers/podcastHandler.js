/**
 * Main handler for podcast audio generation
 */
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const crypto = require('crypto');

// Import utility modules
const { trace, logMemoryUsage, logBufferSizes } = require('../utils/logging');
const { updateProgress, startWatchdog } = require('../utils/monitoring');
const RateLimiter = require('../utils/rateLimiter');

// Import service modules
const { accessSecret } = require('../services/secrets');
const { updateJobStatus, logProcessingEvent, createAudioFileEntry, 
        createArticleAudioMappings, uploadAudioBuffer, getFilePublicUrl } = require('../services/database');
const { generateIntroduction, generateArticleDiscussions, generateConclusion, 
        parseScriptIntoLines, assembleFullScript } = require('../services/content');
const { generateAudioBatch, combineAudioBuffers, freeAudioBuffers } = require('../services/audio');

/**
 * Main function to process podcast audio generation
 * @param {object} req - HTTP request object
 * @param {object} res - HTTP response object
 * @returns {Promise<void>}
 */
async function processPodcastAudio(req, res) {
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

    // Generate content: introduction, article discussions, and conclusion
    currentState = 'generating_content';
    currentStep = 'script_generation';
    
    // Update progress for watchdog
    updateProgress('generating_content', { 
      stage: 'script_generation',
      articles: articles.length 
    });
    
    // Generate introduction
    currentStep = 'introduction';
    progressDetails = { phase: 'introduction' };
    const introScript = await generateIntroduction(articles, openai, openaiRateLimiter);
    logMemoryUsage('After Introduction Generation');
    
    // Generate article discussions
    currentStep = 'article_discussions';
    progressDetails = { phase: 'article_discussions' };
    const articleScripts = await generateArticleDiscussions(articles, openai, openaiRateLimiter);
    
    // Generate conclusion
    currentStep = 'conclusion';
    progressDetails = { phase: 'conclusion' };
    const conclusionScript = await generateConclusion(articles, openai, openaiRateLimiter);
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
    
    const script = assembleFullScript(introScript, articleScripts, conclusionScript);

    // Save the generated script to the database
    await updateJobStatus(supabaseAdmin, jobId, 'script_generated', {
      script: script,
      script_status: 'completed'
    });
    
    // Log script generation completion
    await logProcessingEvent(supabaseAdmin, jobId, 'script_generated', 'Generated podcast script');
    logMemoryUsage('After Script Generation');

    // Parse script into lines for each speaker
    const lines = parseScriptIntoLines(script);

    currentState = 'generating_audio';
    currentStep = 'audio_generation';

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
    const combinedBuffer = combineAudioBuffers(audioPromises, audioMetadata);
    
    // Release individual audio buffers to free memory
    freeAudioBuffers(audioPromises);

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

    // Upload the file to storage
    try {
      await uploadAudioBuffer(supabaseAdmin, 'audio-files', fileName, combinedBuffer);
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
    const publicUrl = getFilePublicUrl(supabaseAdmin, 'audio-files', fileName);
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
    const audioFile = await createAudioFileEntry(supabaseAdmin, publicUrl, userId);

    // Create entries in article_audio table
    await createArticleAudioMappings(supabaseAdmin, articles, audioFile.id, userId);

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
}

module.exports = {
  processPodcastAudio
}; 