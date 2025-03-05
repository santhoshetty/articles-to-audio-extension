const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Secret Manager client for accessing secrets
const secretManagerClient = new SecretManagerServiceClient();

// Helper function to access secrets
async function accessSecret(secretName) {
  const name = `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`;
  const [version] = await secretManagerClient.accessSecretVersion({ name });
  return version.payload.data.toString();
}

// Main function handler for GCP Cloud Functions
functions.http('processPodcastAudio', async (req, res) => {
  try {
    // Log request received
    console.log("Podcast audio processor function called");
    
    // Get the request data
    const { articles, jobId, userId, authToken } = req.body;
    console.log("Received articles:", JSON.stringify(articles, null, 2));
    console.log("Job ID:", jobId);
    console.log("User ID:", userId);
    
    // Validate request data
    if (!articles || !Array.isArray(articles)) {
      console.error("Invalid articles format:", articles);
      return res.status(400).json({ error: "Articles must be an array", success: false });
    }

    if (articles.length === 0) {
      console.error("Empty articles array");
      return res.status(400).json({ error: "At least one article is required", success: false });
    }

    if (!jobId) {
      console.error("Missing job ID");
      return res.status(400).json({ error: "Job ID is required", success: false });
    }

    if (!userId) {
      console.error("Missing user ID");
      return res.status(400).json({ error: "User ID is required", success: false });
    }

    if (!authToken) {
      console.error("Missing auth token");
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

    // Get secrets from Secret Manager
    const [openaiApiKey, supabaseUrl, supabaseServiceKey] = await Promise.all([
      accessSecret('openai_api_key'),
      accessSecret('supabase-url'),
      accessSecret('supabase-service-key')
    ]);

    // Initialize OpenAI with the API key
    const openai = new OpenAI({ apiKey: openaiApiKey });

    // Initialize Supabase client with service key for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Initialize Supabase client with user's auth token for user-specific operations
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    });

    // Update job status to processing
    await updateJobStatus(supabaseAdmin, jobId, 'processing', {
      processing_started_at: new Date().toISOString()
    });
    
    // Log processing start
    await logProcessingEvent(supabaseAdmin, jobId, 'processing_started', 'Started processing podcast audio');

    // Generate conversation script
    console.log("Generating conversation script...");

    // Process all articles in one go without chunking
    console.log(`Processing ${articles.length} articles in one go`);

    // Create reusable template sections to reduce repetition
    const mainDiscussionTemplate = `2. Main Discussion:
  For each article, cover these aspects in a natural conversation:
  - Definition and Background:
    - Alice defines the topic and provides historical context.
    - Bob adds interesting facts or anecdotes related to the topic.
  - Current Relevance and Applications:
    - Both hosts discuss how the topic applies in today's world.
    - Include real-world examples, case studies, or recent news.
  - Challenges and Controversies:
    - Hosts explore any debates or challenges associated with the topic.
    - Present multiple viewpoints to provide a balanced perspective.
  - Future Outlook:
    - Hosts speculate on the future developments related to the topic.
    - Discuss potential innovations or changes on the horizon.`;

    const toneStyleTemplate = `Tone and Style:
  - Conversational and engaging, as if speaking directly to the listener.
  - Use inclusive language to foster a sense of community.
  - Incorporate light humor or personal anecdotes where appropriate to humanize the discussion.`;

    const guidelinesTemplate = `Additional Guidelines:
  - Ensure a balanced exchange between both hosts, allowing each to contribute equally.
  - Use clear and concise language, avoiding jargon unless it's explained.
  - Aim for smooth transitions between topics to maintain listener interest.
  - IMPORTANT: DO NOT use terms like "Segment 1" or "Section 2" in the actual dialogue.
  - Consider the use of rhetorical questions to engage the audience and provoke thought.
  - ALWAYS refer to the hosts by their actual names (Alice and Bob), not as "Host 1" or "Host 2".`;

    const formatTemplate = `Format it like a real dialogue:
Alice: ...
Bob: ...
Alice: ...
Bob: ...
Continue this structure with natural conversation flow.`;

    // Get all article titles for the introduction
    const allArticleTitles = articles.map(article => article.title);
    
    // Create a single prompt for all articles
    const scriptPrompt = `You are two podcast hosts, Alice and Bob.

Create a podcast script where two hosts engage in a dynamic 
and informative conversation about the articles given below. The discussion should be accessible 
to a general audience, providing clear explanations, real-world examples, 
and diverse perspectives. Some articles have summaries as well attached.

${articles.map((article, i) => `Article ${i + 1}: ${article.title}
${article.summary || article.content}`).join('\n\n')}

Structure:

1. Introduction (1 minute):
  - Alice greets listeners and introduces Bob.
  - Brief overview of the episode's topic and its relevance.
  - Mention that today you'll be discussing ALL of these topics: ${allArticleTitles.join(', ')}
  - Create excitement about the full range of articles being covered in this episode.

${mainDiscussionTemplate}

3. Conclusion (1 minute):
  - Hosts summarize key takeaways from the discussion.
  - Encourage listeners to reflect on the topic or engage further.
  - Thank the audience for listening and mention any future episodes.

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}`;

    // Generate script for all articles at once
    const scriptResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: scriptPrompt
        }
      ],
      max_tokens: 4096,
      temperature: 0.7
    });
    
    const script = scriptResponse.choices[0].message.content.trim();
    console.log("Script generated for all articles in one go");

    // Save the generated script to the database
    await updateJobStatus(supabaseAdmin, jobId, 'script_generated', {
      script: script,
      script_status: 'completed'
    });
    
    // Log script generation completion
    await logProcessingEvent(supabaseAdmin, jobId, 'script_generated', 'Generated podcast script');

    // Parse script into lines for each speaker
    const lines = script.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => line.trim())
      .filter(line => line.match(/^(Alice|Bob):?/i)); // Only keep lines with Alice or Bob prefixes

    // Generate audio for each line in order, with proper voice assignment
    console.log("Generating audio for speakers...");
    const audioPromises = [];
    const audioMetadata = []; // Keep track of which voice was used for each segment

    for (const line of lines) {
      const cleanedLine = line.replace(/^(Alice|Bob):?\s*/i, '').trim();
      // Determine if this is Alice or Bob
      const isAlice = line.match(/^Alice:?/i);
      const voice = isAlice ? "alloy" : "onyx";
      
      console.log(`Generating audio for: "${cleanedLine.substring(0, 50)}..." with voice: ${voice}`);
      
      try {
        const response = await openai.audio.speech.create({
          model: "tts-1",
          voice: voice,
          input: cleanedLine
        });
        
        const buffer = Buffer.from(await response.arrayBuffer());
        audioPromises.push(buffer);
        audioMetadata.push({ isAlice, voice });
      } catch (error) {
        console.error(`Error generating audio for line: "${cleanedLine.substring(0, 50)}..."`, error);
        // Log the error to the database
        await logProcessingEvent(supabaseAdmin, jobId, 'audio_generation_error', 
          `Error generating audio for line: "${cleanedLine.substring(0, 50)}..."`, 
          { error: error.message });
        // Continue with other lines even if one fails
      }
    }

    console.log(`Generated ${audioPromises.length} audio segments with alternating voices`);

    // Log audio generation completion
    await logProcessingEvent(supabaseAdmin, jobId, 'audio_generated', 'Generated all audio segments');

    // Combine all audio buffers
    const totalLength = audioPromises.reduce((acc, buf) => acc + buf.length, 0);
    const combinedBuffer = Buffer.alloc(totalLength);
    let offset = 0;
    for (let i = 0; i < audioPromises.length; i++) {
      const buffer = audioPromises[i];
      buffer.copy(combinedBuffer, offset);
      offset += buffer.length;
      
      // Log which speaker and voice was used
      console.log(`Added segment ${i+1}: ${audioMetadata[i].isAlice ? 'Alice (alloy)' : 'Bob (onyx)'}, Length: ${buffer.length} bytes`);
    }

    // Log audio combination completion
    await logProcessingEvent(supabaseAdmin, jobId, 'audio_combined', 'Combined all audio segments');

    // Generate a unique ID for the audio file
    const filenameID = crypto.randomUUID();
    const fileName = `public/${filenameID}.mp3`;

    // Log upload attempt details
    console.log('Attempting file upload:', {
      fileName,
      bucket: 'audio-files',
      contentType: 'audio/mp3',
      bufferSize: combinedBuffer.length
    });

    // Function to attempt upload with retry
    const attemptUpload = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          // Upload the combined audio to Supabase storage
          console.log(`Upload attempt ${i + 1} of ${retries}...`);
          const { data, error } = await supabaseAdmin.storage
            .from('audio-files')
            .upload(fileName, combinedBuffer, {
              contentType: 'audio/mp3',
              upsert: false
            });

          if (error) {
            console.error(`Upload attempt ${i + 1} failed:`, {
              message: error.message,
              details: error.details,
              status: error.status,
              fileName,
              attempt: i + 1
            });
            
            // Log the error to the database
            await logProcessingEvent(supabaseAdmin, jobId, 'upload_error', 
              `Upload attempt ${i + 1} failed: ${error.message}`, 
              { details: error.details, status: error.status });
              
            if (i === retries - 1) throw error;
          } else {
            console.log('Upload successful:', data);
            return data;
          }
        } catch (err) {
          if (i === retries - 1) throw err;
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    };

    // Attempt upload with retry logic
    try {
      await attemptUpload();
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
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('audio-files')
      .getPublicUrl(fileName);

    // Log file upload completion
    await logProcessingEvent(supabaseAdmin, jobId, 'file_uploaded', 'Uploaded audio file to storage', 
      { file_url: publicUrl });

    // Create entry in audio_files table
    const audioFileData = {
      file_url: publicUrl,
      created_at: new Date().toISOString(),
      user_id: userId
    };

    console.log("Attempting to insert audio file entry:", audioFileData);

    const { data: audioFile, error: audioFileError } = await supabaseAdmin
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
      
      // Update job status to failed
      await updateJobStatus(supabaseAdmin, jobId, 'failed', {
        processing_completed_at: new Date().toISOString()
      });
      
      // Log the error to the database
      await logProcessingEvent(supabaseAdmin, jobId, 'database_error', 
        'Error inserting audio file entry', 
        { error: audioFileError.message, details: audioFileError.details });
        
      return res.status(500).json({ 
        error: 'Failed to insert audio file entry', 
        details: audioFileError.message,
        success: false 
      });
    }

    console.log("Successfully inserted audio file entry");

    // Create entries in article_audio table
    const articleAudioEntries = articles.map(article => ({
      article_id: article.id,
      audio_id: audioFile.id,
      user_id: userId
    }));

    console.log("Attempting to insert article audio map entries: ", articleAudioEntries);

    const { error: articleAudioError } = await supabaseAdmin
      .from('article_audio')
      .insert(articleAudioEntries);

    if (articleAudioError) {
      console.error('Error inserting article audio map entries:', {
        message: articleAudioError.message,
        details: articleAudioError.details,
        hint: articleAudioError.hint,
        status: articleAudioError.status
      });
      
      // Update job status to failed
      await updateJobStatus(supabaseAdmin, jobId, 'failed', {
        processing_completed_at: new Date().toISOString()
      });
      
      // Log the error to the database
      await logProcessingEvent(supabaseAdmin, jobId, 'database_error', 
        'Error inserting article audio map entries', 
        { error: articleAudioError.message, details: articleAudioError.details });
        
      return res.status(500).json({ 
        error: 'Failed to insert article audio map entries', 
        details: articleAudioError.message,
        success: false 
      });
    }

    console.log("Successfully inserted article audio map entries");

    // Update job status to completed
    await updateJobStatus(supabaseAdmin, jobId, 'completed', {
      processing_completed_at: new Date().toISOString()
    });
    
    // Log processing completion
    await logProcessingEvent(supabaseAdmin, jobId, 'processing_completed', 'Completed podcast audio processing');

    // Return success response
    return res.status(200).json({ 
      audio_file_id: audioFile.id,
      audio_url: publicUrl,
      job_id: jobId,
      success: true 
    });
  } catch (error) {
    // Log the error details for debugging
    console.error('Error in generate-podcast function:', {
      error: error.message,
      stack: error.stack,
      jobId: req.body?.jobId || 'unknown',
      userId: req.body?.userId || 'unknown'
    });

    // Try to update job status to failed if possible
    try {
      if (req.body && req.body.jobId) {
        const [supabaseUrl, supabaseServiceKey] = await Promise.all([
          accessSecret('supabase-url'),
          accessSecret('supabase-service-key')
        ]);
        
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        
        await updateJobStatus(supabaseAdmin, req.body.jobId, 'failed', {
          processing_completed_at: new Date().toISOString()
        });
        
        await logProcessingEvent(supabaseAdmin, req.body.jobId, 'processing_failed', 
          'Error in podcast audio processor', 
          { error: error.message, stack: error.stack });
      }
    } catch (logError) {
      console.error('Failed to log error to database:', logError);
    }

    // Return detailed error response
    return res.status(500).json({ 
      error: error.message,
      success: false,
      details: {
        type: error.name,
        cause: error.cause
      }
    });
  }
});

// Helper function to update job status
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

// Helper function to log processing events
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