# Deployment Guide for Supabase Edge Functions

This document provides detailed instructions for deploying the Supabase Edge Functions required for the GCP migration of podcast audio processing.

## 1. Install Supabase CLI

If you haven't already installed the Supabase CLI, you can do so:

### Using npm:
```bash
npm install -g supabase
```

### Using Homebrew (macOS):
```bash
brew install supabase/tap/supabase
```

## 2. Login to Supabase

```bash
supabase login
```

Follow the prompts to authenticate with your Supabase account.

## 3. Set GCP Cloud Function URL

Once you've deployed the GCP Cloud Function, you need to set the function URL as an environment variable in Supabase:

```bash
# Replace with your Supabase project reference and the actual GCP function URL
supabase secrets set GCP_FUNCTION_URL=https://YOUR_GCP_FUNCTION_URL \
  --project-ref YOUR_SUPABASE_PROJECT_REF
```

## 4. Deploy the Edge Functions

Deploy both Edge Functions to your Supabase project:

```bash
# Deploy enqueue-podcast-job
supabase functions deploy enqueue-podcast-job \
  --project-ref YOUR_SUPABASE_PROJECT_REF

# Deploy check-podcast-status
supabase functions deploy check-podcast-status \
  --project-ref YOUR_SUPABASE_PROJECT_REF
```

## 5. Apply Database Schema Changes

Using the Supabase Dashboard or SQL Editor, apply the database schema changes:

```sql
-- Apply database schema changes
BEGIN;

-- Add new columns to podcast_jobs table
ALTER TABLE IF EXISTS public.podcast_jobs
ADD COLUMN IF NOT EXISTS processing_mode VARCHAR(50) DEFAULT 'gcp',
ADD COLUMN IF NOT EXISTS gcp_job_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS script_status VARCHAR(50) DEFAULT 'pending';

-- Create processing_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.processing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID REFERENCES podcast_jobs(id),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  event_type VARCHAR(50),
  message TEXT,
  details JSONB
);

COMMIT;
```

## 6. Test the Edge Functions

### Test enqueue-podcast-job function:
```bash
curl -X POST https://YOUR_SUPABASE_PROJECT_REF.functions.supabase.co/enqueue-podcast-job \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "articles": [
      {
        "id": "article-id",
        "title": "Article Title",
        "content": "Article content..."
      }
    ]
  }'
```

### Test check-podcast-status function:
```bash
curl -X GET "https://YOUR_SUPABASE_PROJECT_REF.functions.supabase.co/check-podcast-status?job_id=YOUR_JOB_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 7. Monitoring

You can monitor your Edge Functions through the Supabase Dashboard:

1. Go to your Supabase project dashboard
2. Navigate to the "Edge Functions" tab
3. Click on a function to view its logs and invocation statistics

## 8. Troubleshooting

If you encounter issues:

1. **Function Deployment Fails:**
   ```bash
   supabase functions deploy your-function-name --project-ref your-project-ref --debug
   ```

2. **Invalid Environment Variables:**
   ```bash
   supabase secrets list --project-ref your-project-ref
   ```

3. **Function Execution Fails:**
   ```bash
   supabase functions logs your-function-name --project-ref your-project-ref
   ```

## 9. Update Frontend Configuration

Finally, update your frontend code to use the new Edge Functions instead of the original `generate-podcast` function. This typically involves:

1. Changing API endpoints
2. Implementing polling for job status
3. Updating the UI to display job status and progress 