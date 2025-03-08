/**
 * Database service for interacting with Supabase
 */

/**
 * Updates the status of a podcast job
 * @param {object} supabaseClient - Supabase client
 * @param {string} jobId - ID of the job to update
 * @param {string} status - New status of the job
 * @param {object} additionalData - Additional data to update
 * @returns {Promise<void>}
 */
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

/**
 * Logs a processing event for a podcast job
 * @param {object} supabaseClient - Supabase client
 * @param {string} jobId - ID of the job
 * @param {string} eventType - Type of event
 * @param {string} message - Event message
 * @param {object} details - Event details
 * @returns {Promise<void>}
 */
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
 * Creates an entry in the audio_files table
 * @param {object} supabaseClient - Supabase client
 * @param {string} fileUrl - URL of the audio file
 * @param {string} userId - ID of the user who created the file
 * @returns {Promise<object>} The created audio file entry
 */
async function createAudioFileEntry(supabaseClient, fileUrl, userId) {
  const audioFileData = {
    file_url: fileUrl,
    created_at: new Date().toISOString(),
    user_id: userId
  };

  console.log("Attempting to insert audio file entry:", audioFileData);

  const { data: audioFile, error: audioFileError } = await supabaseClient
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
    throw audioFileError;
  }

  console.log("Successfully inserted audio file entry");
  return audioFile;
}

/**
 * Creates entries in the article_audio table to map articles to an audio file
 * @param {object} supabaseClient - Supabase client
 * @param {Array<object>} articles - Articles to map
 * @param {string} audioId - ID of the audio file
 * @param {string} userId - ID of the user
 * @returns {Promise<void>}
 */
async function createArticleAudioMappings(supabaseClient, articles, audioId, userId) {
  const articleAudioEntries = articles.map(article => ({
    article_id: article.id,
    audio_id: audioId,
    user_id: userId
  }));

  console.log("Attempting to insert article audio map entries: ", articleAudioEntries);

  const { error: articleAudioError } = await supabaseClient
    .from('article_audio')
    .insert(articleAudioEntries);

  if (articleAudioError) {
    console.error('Error inserting article audio map entries:', {
      message: articleAudioError.message,
      details: articleAudioError.details,
      hint: articleAudioError.hint,
      status: articleAudioError.status
    });
    throw articleAudioError;
  }

  console.log("Successfully inserted article audio map entries");
}

/**
 * Uploads an audio buffer to Supabase Storage
 * @param {object} supabaseClient - Supabase client
 * @param {string} bucketName - Name of the storage bucket
 * @param {string} filePath - Path of the file in the bucket
 * @param {Buffer} buffer - Buffer to upload
 * @param {number} retries - Number of retries for failed uploads
 * @returns {Promise<object>} Upload response data
 */
async function uploadAudioBuffer(supabaseClient, bucketName, filePath, buffer, retries = 3) {
  const { logMemoryUsage, trace, formatBytes } = require('../utils/logging');
  
  // Function to attempt upload with retry
  for (let i = 0; i < retries; i++) {
    try {
      // Upload the combined audio to Supabase storage
      console.log(`Upload attempt ${i + 1} of ${retries}...`);
      const uploadTraceId = trace.start(`Upload attempt ${i + 1} of ${retries}`);
      trace.checkpoint(`Initiating storage upload for file: ${filePath} (${formatBytes(buffer.length)})`);
      
      const { data, error } = await supabaseClient.storage
        .from(bucketName)
        .upload(filePath, buffer, {
          contentType: 'audio/mp3',
          upsert: false
        });

      if (error) {
        trace.checkpoint(`Upload failed with error: ${error.message}`);
        console.error(`Upload attempt ${i + 1} failed:`, {
          message: error.message,
          details: error.details,
          status: error.status,
          filePath,
          attempt: i + 1
        });
        
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
  
  throw new Error('All upload attempts failed');
}

/**
 * Gets the public URL for a file in Supabase Storage
 * @param {object} supabaseClient - Supabase client
 * @param {string} bucketName - Name of the storage bucket
 * @param {string} filePath - Path of the file in the bucket
 * @returns {string} Public URL of the file
 */
function getFilePublicUrl(supabaseClient, bucketName, filePath) {
  const { data: { publicUrl } } = supabaseClient.storage
    .from(bucketName)
    .getPublicUrl(filePath);
  
  return publicUrl;
}

module.exports = {
  updateJobStatus,
  logProcessingEvent,
  createAudioFileEntry,
  createArticleAudioMappings,
  uploadAudioBuffer,
  getFilePublicUrl
}; 