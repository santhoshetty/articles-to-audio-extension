# GCP Migration Checklist

Use this checklist to track progress on the podcast audio processing migration from Supabase Edge Functions to Google Cloud Platform.

## Phase 1: Infrastructure Setup

- [x] **Google Cloud SDK**
  - [x] Install Google Cloud SDK
  - [x] Initialize SDK with `gcloud init`
  - [x] Configure project and region settings

- [x] **Secret Manager Setup**
  - [x] Create `openai-api-key` secret
  - [x] Create `supabase-url` secret
  - [x] Create `supabase-service-key` secret
  - [x] Grant Cloud Function service account access to Secret Manager

- [x] **GCP Cloud Function**
  - [x] Prepare function directory `gcp/functions/generate-podcast`
  - [x] Create `package.json` with dependencies
  - [x] Create main function code `index.js`
  - [x] Install dependencies with `npm install`

## Phase 2: Core Development

- [x] **GCP Cloud Function Implementation**
  - [x] Remove chunking logic to process articles in one go
  - [x] Implement script generation logic
  - [x] Implement audio generation logic
  - [x] Implement file upload logic
  - [x] Add error handling and retries
  - [x] Set up logging for events

- [x] **Supabase Edge Functions**
  - [x] Create `enqueue-podcast-job` function
  - [x] Create `check-podcast-status` function
  - [x] Add error handling
  - [x] Add authentication and authorization checks

- [x] **Database Schema Changes**
  - [x] Add new columns to `podcast_jobs` table
  - [x] Create `processing_logs` table

## Phase 3: Deployment

- [x] **GCP Cloud Function Deployment**
  - [x] Deploy function with `npm run deploy`
  - [x] Get function URL for Supabase integration
  - [x] Test function with direct HTTP request

- [x] **Supabase Edge Functions Deployment**
  - [x] Set `GCP_FUNCTION_URL` environment variable
  - [x] Deploy `enqueue-podcast-job` function
  - [x] Deploy `check-podcast-status` function
  - [x] Test functions with direct HTTP requests

- [x] **Database Schema Updates**
  - [x] Apply schema changes via SQL commands
  - [x] Test schema with sample data

## Phase 4: Frontend Integration

- [x] **Update Frontend Code**
  - [x] Update API calls to use new edge functions
  - [x] Add job status polling logic
  - [x] Create UI components for displaying job status
  - [x] Add CSS styles for status indicators
  - [x] Implement feature flag for gradual rollout
  - [x] Add error handling and retry logic

## Phase 5: Testing and Validation

- [x] **Basic Functionality Testing**
  - [x] Test function authentication and access
  - [x] Test with valid UUID format for job ID
  - [x] Fix database schema to add 'script' column to 'podcast_jobs' table
  - [ ] Test with 1-2 articles
  - [ ] Test with 5+ articles
  - [ ] Verify correct audio generation
  - [ ] Test error scenarios

- [ ] **Performance Testing**
  - [ ] Measure end-to-end processing time
  - [ ] Test concurrent processing with multiple users
  - [ ] Compare performance with original implementation

- [ ] **Edge Case Testing**
  - [ ] Test with articles containing special characters
  - [ ] Test with very long articles
  - [ ] Test with missing fields or edge cases

## Phase 6: Rollout and Monitoring

- [ ] **Gradual Rollout**
  - [ ] Enable feature flag for a small group of users
  - [ ] Monitor error rates and performance
  - [ ] Gradually increase rollout percentage
  - [ ] Enable for all users once stable

- [ ] **Monitoring Setup**
  - [ ] Set up GCP Cloud Function monitoring
  - [ ] Set up Supabase logging
  - [ ] Create alerts for critical failures
  - [ ] Establish performance baselines

- [ ] **Documentation and Knowledge Transfer**
  - [ ] Update technical documentation
  - [ ] Document troubleshooting procedures
  - [ ] Train support team on new workflow
  - [ ] Create user-facing documentation for changes

## Rollback Plan

In case of critical issues:

- [ ] **Prepare Rollback Mechanism**
  - [ ] Ensure original `generate-podcast` function is still operational
  - [ ] Create feature flag toggle for immediate switch back
  - [ ] Test rollback procedure
  - [ ] Document rollback steps for team members 