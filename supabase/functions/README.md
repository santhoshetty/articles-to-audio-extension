# Supabase Edge Functions for Podcast Generation

This directory contains Supabase Edge Functions for the Articles to Audio Extension, specifically for the GCP migration of podcast audio processing.

## Functions Overview

### 1. `enqueue-podcast-job`

This function creates a new podcast job in the database and sends it to the GCP Cloud Function for processing.

**Environment Variables:**
- `GCP_FUNCTION_URL`: The URL of the GCP Cloud Function for podcast audio processing

**Request Format:**
```json
{
  "articles": [
    {
      "id": "article-id",
      "title": "Article Title",
      "content": "Article content...",
      "summary": "Optional summary..."
    }
  ]
}
```

**Response Format:**
```json
{
  "job_id": "podcast-job-id",
  "success": true
}
```

### 2. `check-podcast-status`

This function checks the status of a podcast job and returns the job details, logs, and audio file information if available.

**Query Parameters:**
- `job_id`: The ID of the podcast job to check

**Response Format:**
```json
{
  "job": {
    "id": "podcast-job-id",
    "status": "pending|processing|script_generated|completed|failed",
    "script_status": "pending|completed",
    "created_at": "timestamp",
    "updated_at": "timestamp",
    "processing_started_at": "timestamp",
    "processing_completed_at": "timestamp"
  },
  "audio": {
    "id": "audio-file-id",
    "file_url": "https://public-url-to-audio-file.mp3",
    "created_at": "timestamp",
    "user_id": "user-id"
  },
  "logs": [
    {
      "id": "log-id",
      "job_id": "podcast-job-id",
      "timestamp": "timestamp",
      "event_type": "event-type",
      "message": "log-message",
      "details": {}
    }
  ],
  "success": true
}
```

### 3. `generate-podcast` (Legacy)

This is the original podcast generation function that will be replaced by the GCP Cloud Function. It will be kept for backward compatibility during the migration.

## Deployment

To deploy these functions to Supabase:

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Deploy a specific function
supabase functions deploy enqueue-podcast-job --project-ref your-project-ref
supabase functions deploy check-podcast-status --project-ref your-project-ref

# Set environment variables
supabase secrets set GCP_FUNCTION_URL=https://your-gcp-function-url --project-ref your-project-ref
```

## Local Development

To run these functions locally:

```bash
# Start the Supabase local development server
supabase start

# Serve a specific function
supabase functions serve enqueue-podcast-job --env-file .env.local
supabase functions serve check-podcast-status --env-file .env.local
```

Create a `.env.local` file with the following variables:

```
GCP_FUNCTION_URL=https://your-gcp-function-url
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

## Testing

You can test these functions using curl or any HTTP client:

```bash
# Test enqueue-podcast-job
curl -X POST https://your-project-ref.supabase.co/functions/v1/enqueue-podcast-job \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{"articles":[{"id":"article-id","title":"Article Title","content":"Article content..."}]}'

# Test check-podcast-status
curl -X GET "https://your-project-ref.supabase.co/functions/v1/check-podcast-status?job_id=podcast-job-id" \
  -H "Authorization: Bearer your-jwt-token"
``` 