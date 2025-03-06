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
  let supabaseAdmin = null;
  let jobId = null;
  
  try {
    // Log request received
    console.log("Podcast audio processor function called");
    
    // Get the request data
    const { articles, jobId: requestJobId, userId, authToken } = req.body;
    jobId = requestJobId; // Store jobId in the outer scope for error handling
    
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
    await updateJobStatus(supabaseAdmin, jobId, 'processing', {
      processing_started_at: new Date().toISOString()
    });
    
    // Log processing start
    await logProcessingEvent(supabaseAdmin, jobId, 'processing_started', 'Started processing podcast audio');

    // Process all articles in one go without chunking
    console.log(`Processing ${articles.length} articles in one go`);

    // Create reusable template sections to reduce repetition
    const mainDiscussionTemplate = `Create a focused discussion about this specific article that will last for at least 3.5 minutes:
  - Definition and Background (45-60 seconds):
    - Alice defines the topic and provides historical context.
    - Bob adds interesting facts or anecdotes related to the topic.
    - Include sufficient detail to properly introduce the topic to listeners.
    - Provide at least 3-4 exchanges between hosts in this section.
  
  - Current Relevance and Applications (60-75 seconds):
    - Both hosts discuss how the topic applies in today's world.
    - Include real-world examples, case studies, or recent news.
    - Explore multiple areas where this topic has current relevance and impact.
    - This should be your most detailed section with at least 4-5 exchanges between hosts.
  
  - Challenges and Controversies (45-60 seconds):
    - Hosts explore any debates or challenges associated with the topic.
    - Present multiple viewpoints to provide a balanced perspective.
    - Discuss potential solutions or approaches to these challenges.
    - Include at least 3-4 exchanges between hosts in this section.
  
  - Future Outlook (30-45 seconds):
    - Hosts speculate on the future developments related to the topic.
    - Discuss potential innovations or changes on the horizon.
    - Consider how this might affect listeners or society as a whole.
    - Include at least 2-3 exchanges between hosts to wrap up the discussion.
  
  IMPORTANT: The discussion for this article should try to be 3.5 minutes in total. Ensure sufficient depth and detail in each section to meet this time requirement.`;

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
    
    console.log("Generating introduction...");
    
    // Create introduction prompt
    const introPrompt = `You are two podcast hosts, Alice and Bob.

Create ONLY the introduction section for a podcast where two hosts engage in a dynamic 
and informative conversation about multiple articles. The introduction should be approximately 1 minute long.

Here are the titles of all articles that will be discussed:
${allArticleTitles.join('\n')}

The introduction should include:
- Alice greeting listeners and introducing Bob.
- Brief overview of the episode's topic and its relevance.
- Mention that today you'll be discussing ALL of these topics: ${allArticleTitles.join(', ')}
- Create excitement about the full range of articles being covered in this episode.
- Indicate that this will be a longer, in-depth episode with substantial time devoted to each topic.

DO NOT start discussing any specific article yet - this is ONLY the introduction.

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}`;

    // Generate introduction
    const introResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: introPrompt
        }
      ],
      max_tokens: 4096,
      temperature: 0.7
    });
    
    const introScript = introResponse.choices[0].message.content.trim();
    console.log("Introduction generated");
    
    // Generate discussion for each article
    console.log("Generating discussions for each article...");
    
    const articleScripts = [];
    
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      console.log(`Generating discussion for article ${i + 1}: ${article.title}`);
      
      // Create prompt for this specific article
      const articlePrompt = `You are two podcast hosts, Alice and Bob.

You are in the middle of a podcast episode where you're discussing multiple articles.
You've already introduced the podcast and now need to create a focused discussion about this specific article:

Title: ${article.title}
${article.summary || article.content}

${mainDiscussionTemplate}

IMPORTANT:
- DO NOT create an introduction for the podcast - you're already in the middle of the episode.
- DO NOT include any conclusion for the overall podcast.
- DO NOT reference that this is "the first article" or "the next article" or use any numbering.
- If this isn't the first article, start with a natural transition from a previous topic.
- CRITICAL: Your response MUST contain enough detailed content to fill AT LEAST 3.5 minutes of speaking time.
- Each section should be comprehensive and in-depth - be thorough in your analysis and discussion.
- Include substantial dialogue for each point - aim for 2-3 exchanges between hosts per subtopic.
- Remember that spoken content takes longer than reading - aim for approximately 525-550 words minimum.
- The final output should feel like a complete, substantive segment that could stand on its own.

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}`;

      // Generate script for this article
      const articleResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: articlePrompt
          }
        ],
        max_tokens: 4096,  // Keep maximum token limit
        temperature: 0.7
      });
      
      const articleScript = articleResponse.choices[0].message.content.trim();
      articleScripts.push(articleScript);
      
      // Calculate and log the word count and estimated time
      const wordCount = articleScript.split(/\s+/).length;
      const estimatedMinutes = (wordCount / 150).toFixed(2); // Assuming ~150 words per minute for podcasts
      console.log(`Discussion generated for article ${i + 1}: ${wordCount} words, ~${estimatedMinutes} minutes`);
      
      // If the content seems too short, log a warning
      if (wordCount < 500) {
        console.warn(`WARNING: Article ${i + 1} discussion may be too short at ${wordCount} words (target: 525-550+ words)`);
      }
    }
    
    console.log("Generating conclusion...");
    
    // Create conclusion prompt
    const conclusionPrompt = `You are two podcast hosts, Alice and Bob.

Create ONLY the conclusion section for a podcast where you've just finished discussing these articles:
${allArticleTitles.join('\n')}

The conclusion should be approximately 1 minute long and include:
- Hosts summarizing key takeaways from the discussions.
- Encouragement for listeners to reflect on the topics or engage further.
- Thanking the audience for listening and mentioning any future episodes.

This is ONLY the conclusion - assume all articles have already been thoroughly discussed.

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}`;

    // Generate conclusion
    const conclusionResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: conclusionPrompt
        }
      ],
      max_tokens: 4096,
      temperature: 0.7
    });
    
    const conclusionScript = conclusionResponse.choices[0].message.content.trim();
    console.log("Conclusion generated");
    
    // Combine all parts into a single script
    const fullScript = [
      introScript,
      ...articleScripts,
      conclusionScript
    ].join('\n\n');
    
    const script = fullScript.trim();
    console.log("Full podcast script assembled");

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
      jobId: jobId || req.body?.jobId || 'unknown',
      userId: req.body?.userId || 'unknown'
    });

    // Try to update job status to failed if possible
    try {
      if (jobId) {
        if (!supabaseAdmin) {
          // If supabaseAdmin is not initialized yet, initialize it now
          const [supabaseUrl, supabaseServiceKey] = await Promise.all([
            accessSecret('supabase-url'),
            accessSecret('supabase-service-key')
          ]);
          
          supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        }
        
        await updateJobStatus(supabaseAdmin, jobId, 'failed', {
          processing_completed_at: new Date().toISOString()
        });
        
        await logProcessingEvent(supabaseAdmin, jobId, 'processing_failed', 
          'Error in podcast audio processor', 
          { error: error.message, stack: error.stack });
      }
    } catch (logError) {
      console.error('Failed to log error to database:', logError);
    }

    // If response hasn't been sent yet, send an error response
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: error.message,
        success: false,
        details: {
          type: error.name,
          cause: error.cause
        }
      });
    }
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