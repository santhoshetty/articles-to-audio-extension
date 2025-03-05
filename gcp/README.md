# GCP Migration for Podcast Audio Processing

This directory contains the code and documentation for migrating the podcast audio processing functionality from Supabase Edge Functions to Google Cloud Platform (GCP) Cloud Functions.

## Migration Overview

The migration involves the following components:

1. **GCP Cloud Function: `generate-podcast`**
   - Processes the entire podcast in a single run
   - Handles script generation, audio processing, and storage operations
   - Communicates with Supabase for data retrieval and storage

2. **Supabase Edge Functions:**
   - `enqueue-podcast-job`: Creates a job and sends it to GCP
   - `check-podcast-status`: Allows the frontend to check job status
   - `generate-podcast` (Legacy): Kept for backward compatibility

3. **Database Schema Changes:**
   - Added new columns to `podcast_jobs` table
   - Created `processing_logs` table for detailed event tracking

## Implementation Status

- [x] Created GCP Cloud Function code
- [x] Created Supabase connector functions
- [x] Defined database schema changes
- [ ] Deployed GCP Cloud Function
- [ ] Deployed Supabase Edge Functions
- [ ] Updated frontend to use new API endpoints
- [ ] Tested end-to-end workflow
- [ ] Monitored performance and reliability

## Next Steps

1. **Deploy the GCP Cloud Function:**
   ```bash
   cd functions/generate-podcast
   npm install
   npm run deploy
   ```

2. **Deploy the Supabase Edge Functions:**
   ```bash
   supabase functions deploy enqueue-podcast-job --project-ref your-project-ref
   supabase functions deploy check-podcast-status --project-ref your-project-ref
   ```

3. **Set Environment Variables:**
   ```bash
   # In Supabase
   supabase secrets set GCP_FUNCTION_URL=https://your-gcp-function-url --project-ref your-project-ref
   
   # In GCP
   gcloud functions deploy generate-podcast \
     --update-env-vars PROJECT_ID=your-gcp-project-id
   ```

4. **Update Frontend Code:**
   - Modify the frontend to call the new `enqueue-podcast-job` function instead of `generate-podcast`
   - Implement polling of the `check-podcast-status` function to track job progress
   - Display job status and progress to the user

5. **Testing:**
   - Test with various article combinations
   - Verify concurrent processing works correctly
   - Ensure error handling is robust

6. **Monitoring:**
   - Set up monitoring for the GCP Cloud Function
   - Monitor Supabase database for job statuses
   - Track error rates and processing times

## Rollback Plan

If issues are encountered with the GCP implementation, the system can fall back to the original Supabase Edge Function:

1. Update the frontend to call the original `generate-podcast` function
2. Monitor for any issues with the fallback implementation

## Documentation

- [GCP Cloud Function README](functions/generate-podcast/README.md)
- [Supabase Edge Functions README](../supabase/functions/README.md)
- [Migration PRD](../instructions/podcast_gcp_migration_prd.md) 