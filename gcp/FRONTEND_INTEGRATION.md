# Frontend Integration Guide

This document provides guidance on how to update your frontend code to use the new GCP-powered podcast generation workflow.

## Overview of Changes

The migration to GCP for podcast audio processing introduces a significant change in how podcast generation is handled:

**Old Workflow**:
1. Frontend calls `generate-podcast` Supabase Edge Function directly
2. Function processes podcast and returns the result
3. Frontend receives the result after completion

**New Workflow**:
1. Frontend calls `enqueue-podcast-job` Supabase Edge Function
2. Function creates a job and triggers GCP processing
3. Frontend receives a job ID
4. Frontend periodically polls `check-podcast-status` to get job status
5. When job is complete, frontend displays the result

## Required Frontend Changes

### 1. Update API Calls

Replace calls to the original podcast generation endpoint with calls to the new endpoints:

```javascript
// OLD approach - Direct call to generate-podcast
async function generatePodcast(articles) {
  const { data, error } = await supabaseClient.functions.invoke('generate-podcast', {
    body: { articles }
  });
  
  if (error) throw error;
  return data;
}

// NEW approach - Job-based with status polling
async function startPodcastGeneration(articles) {
  // Step 1: Enqueue the job
  const { data, error } = await supabaseClient.functions.invoke('enqueue-podcast-job', {
    body: { articles }
  });
  
  if (error) throw error;
  return data.job_id; // Return the job ID for status polling
}

async function checkPodcastStatus(jobId) {
  // Step 2: Check job status
  const { data, error } = await supabaseClient.functions.invoke('check-podcast-status', {
    params: { job_id: jobId }
  });
  
  if (error) throw error;
  return data;
}
```

### 2. Implement Polling for Job Status

Add a polling mechanism to check job status:

```javascript
async function pollPodcastStatus(jobId, onStatusUpdate, intervalMs = 5000) {
  // Initialize polling
  const poll = async () => {
    try {
      const status = await checkPodcastStatus(jobId);
      
      // Call the status update callback with the current status
      onStatusUpdate(status);
      
      // If job is still in progress, continue polling
      if (['pending', 'processing', 'script_generated'].includes(status.job.status)) {
        setTimeout(poll, intervalMs);
      }
    } catch (error) {
      console.error('Error polling podcast status:', error);
      onStatusUpdate({ error: error.message });
    }
  };
  
  // Start polling
  poll();
}
```

### 3. Update UI to Show Progress

Enhance the UI to display job progress:

```javascript
function updatePodcastUI(statusData) {
  const statusElement = document.getElementById('podcast-status');
  const audioElement = document.getElementById('podcast-audio');
  
  // Clear previous content
  statusElement.innerHTML = '';
  
  if (statusData.error) {
    // Handle error state
    statusElement.innerHTML = `Error: ${statusData.error}`;
    return;
  }
  
  // Get job status and logs
  const { job, audio, logs } = statusData;
  
  // Show current status
  statusElement.innerHTML = `
    <div class="status-indicator ${job.status}">
      <h3>Podcast Status: ${job.status}</h3>
      <p>Created: ${new Date(job.created_at).toLocaleString()}</p>
      ${job.processing_started_at ? `<p>Processing started: ${new Date(job.processing_started_at).toLocaleString()}</p>` : ''}
      ${job.processing_completed_at ? `<p>Processing completed: ${new Date(job.processing_completed_at).toLocaleString()}</p>` : ''}
    </div>
  `;
  
  // Show progress based on logs
  if (logs && logs.length > 0) {
    const progressElement = document.createElement('div');
    progressElement.className = 'progress-logs';
    progressElement.innerHTML = '<h4>Progress:</h4>';
    
    const logsList = document.createElement('ul');
    logs.forEach(log => {
      const logItem = document.createElement('li');
      logItem.textContent = `${new Date(log.timestamp).toLocaleTimeString()}: ${log.message}`;
      logsList.appendChild(logItem);
    });
    
    progressElement.appendChild(logsList);
    statusElement.appendChild(progressElement);
  }
  
  // Show audio player if completed
  if (job.status === 'completed' && audio) {
    audioElement.innerHTML = `
      <h3>Your Podcast is Ready!</h3>
      <audio controls src="${audio.file_url}"></audio>
      <a href="${audio.file_url}" download="podcast.mp3" class="download-button">Download Audio</a>
    `;
    audioElement.style.display = 'block';
  } else {
    audioElement.style.display = 'none';
  }
}
```

### 4. Put It All Together

Integrate these components in your main podcast generation workflow:

```javascript
// Button click handler for podcast generation
async function handleGeneratePodcastClick() {
  try {
    // Show loading state
    document.getElementById('podcast-status').innerHTML = '<p>Starting podcast generation...</p>';
    document.getElementById('podcast-audio').style.display = 'none';
    document.getElementById('generate-button').disabled = true;
    
    // Get selected articles
    const selectedArticles = getSelectedArticles();
    
    // Start podcast generation and get job ID
    const jobId = await startPodcastGeneration(selectedArticles);
    
    // Show initial job status
    document.getElementById('podcast-status').innerHTML = `<p>Podcast generation started. Job ID: ${jobId}</p>`;
    
    // Start polling for status updates
    pollPodcastStatus(jobId, updatePodcastUI);
  } catch (error) {
    console.error('Error starting podcast generation:', error);
    document.getElementById('podcast-status').innerHTML = `<p>Error: ${error.message}</p>`;
    document.getElementById('generate-button').disabled = false;
  }
}

// Add click event listener to the generate button
document.getElementById('generate-button').addEventListener('click', handleGeneratePodcastClick);
```

### 5. Add CSS for Status Indicators

```css
.status-indicator {
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 15px;
}

.status-indicator.pending {
  background-color: #f0f0f0;
  border-left: 4px solid #888;
}

.status-indicator.processing {
  background-color: #fff8e1;
  border-left: 4px solid #ffc107;
}

.status-indicator.script_generated {
  background-color: #e8f5e9;
  border-left: 4px solid #4caf50;
}

.status-indicator.completed {
  background-color: #e8f5e9;
  border-left: 4px solid #4caf50;
}

.status-indicator.failed {
  background-color: #ffebee;
  border-left: 4px solid #f44336;
}

.progress-logs {
  margin-top: 10px;
  padding: 10px;
  background-color: #f5f5f5;
  border-radius: 4px;
  max-height: 200px;
  overflow-y: auto;
}

.download-button {
  display: inline-block;
  margin-top: 10px;
  padding: 8px 16px;
  background-color: #4285f4;
  color: white;
  text-decoration: none;
  border-radius: 4px;
}

.download-button:hover {
  background-color: #3367d6;
}
```

## Feature Flag for Gradual Rollout

Consider implementing a feature flag to gradually roll out the new functionality:

```javascript
// Check if the GCP migration is enabled
async function isGcpMigrationEnabled() {
  const { data } = await supabaseClient
    .from('feature_flags')
    .select('enabled')
    .eq('name', 'gcp_podcast_migration')
    .single();
    
  return data?.enabled || false;
}

async function generatePodcast(articles) {
  // Check feature flag
  const useGcp = await isGcpMigrationEnabled();
  
  if (useGcp) {
    // Use new GCP workflow
    const jobId = await startPodcastGeneration(articles);
    pollPodcastStatus(jobId, updatePodcastUI);
  } else {
    // Use legacy workflow
    const { data, error } = await supabaseClient.functions.invoke('generate-podcast', {
      body: { articles }
    });
    
    if (error) throw error;
    
    // Update UI directly with result
    document.getElementById('podcast-audio').innerHTML = `
      <h3>Your Podcast is Ready!</h3>
      <audio controls src="${data.audio_url}"></audio>
      <a href="${data.audio_url}" download="podcast.mp3" class="download-button">Download Audio</a>
    `;
    document.getElementById('podcast-audio').style.display = 'block';
  }
}
```

## Handling Errors and Retries

Add robust error handling and retry mechanisms:

```javascript
async function startPodcastGeneration(articles, maxRetries = 3) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const { data, error } = await supabaseClient.functions.invoke('enqueue-podcast-job', {
        body: { articles }
      });
      
      if (error) throw error;
      return data.job_id;
    } catch (error) {
      retries++;
      console.error(`Error starting podcast generation (attempt ${retries}/${maxRetries}):`, error);
      
      if (retries >= maxRetries) {
        throw new Error(`Failed to start podcast generation after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries - 1)));
    }
  }
}
```

## Testing and Validation

Before deploying to production, thoroughly test the new workflow:

1. Test with different article counts and content
2. Verify proper status updates during processing
3. Test error scenarios (e.g., invalid articles, service unavailability)
4. Test concurrent processing with multiple users
5. Verify proper cleanup of resources in case of failures 