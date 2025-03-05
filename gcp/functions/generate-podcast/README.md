# Generate Podcast - GCP Cloud Function

This Cloud Function processes podcast audio for the Articles to Audio Extension. It's designed to run on Google Cloud Platform (GCP) Cloud Functions (2nd gen) with a longer timeout to handle the entire podcast generation process.

## Prerequisites

- Node.js 18+
- Google Cloud SDK (gcloud CLI)
- GCP Project with Cloud Functions, Secret Manager, and Pub/Sub APIs enabled
- Supabase project with the required database schema

## Setup

1. **Create required secrets in GCP Secret Manager:**
   - `openai-api-key`: Your OpenAI API key
   - `supabase-url`: Your Supabase project URL
   - `supabase-service-key`: Your Supabase service role key

2. **Grant the Cloud Function service account access to Secret Manager:**
   ```bash
   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member="serviceAccount:PROJECT_ID@appspot.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

## Local Testing

To test the function locally:

```bash
export PROJECT_ID=your-gcp-project-id
npm start
```

Then send a POST request to `http://localhost:8080` with the required payload.

## Deployment

Deploy the function to GCP:

```bash
npm run deploy
```

Or manually:

```bash
gcloud functions deploy generate-podcast \
  --gen2 \
  --runtime=nodejs18 \
  --region=us-central1 \
  --source=. \
  --entry-point=processPodcastAudio \
  --trigger-http \
  --timeout=3600s \
  --set-env-vars PROJECT_ID=your-gcp-project-id
```

## Function Parameters

The function expects a POST request with the following JSON body:

```json
{
  "articles": [
    {
      "id": "article-id",
      "title": "Article Title",
      "content": "Article content...",
      "summary": "Optional summary..."
    }
  ],
  "jobId": "podcast-job-id",
  "userId": "user-id",
  "authToken": "jwt-token"
}
```

## Response

The function returns a JSON response with the following structure:

```json
{
  "audio_file_id": "audio-file-id",
  "audio_url": "https://public-url-to-audio-file.mp3",
  "job_id": "podcast-job-id",
  "success": true
}
```

## Error Handling

If an error occurs, the function returns a JSON response with the following structure:

```json
{
  "error": "Error message",
  "success": false,
  "details": {
    "type": "Error type",
    "cause": "Error cause"
  }
}
```

## Database Schema

The function interacts with the following Supabase tables:

- `podcast_jobs`: Tracks the status of podcast generation jobs
- `processing_logs`: Logs events during podcast processing
- `audio_files`: Stores metadata about generated audio files
- `article_audio`: Maps articles to audio files 