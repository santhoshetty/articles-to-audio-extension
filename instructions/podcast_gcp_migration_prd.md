# Podcast Audio Processing Migration PRD
**Project:** Articles to Audio Extension - GCP Migration  
**Author:** Santhosh  
**Date:** March 1, 2025  
**Status:** Draft  

---

## Executive Summary

This document details the migration of the podcast audio processing functionality from Supabase Edge Functions to Google Cloud Platform (GCP) Cloud Functions (2nd gen). The migration is necessary to address current processing timeouts and scalability issues. This approach will improve reliability, enable concurrent processing for multiple users, and maintain seamless integration with existing Supabase infrastructure.

---

## Background

The current implementation relies on Supabase Edge Functions for audio generation but suffers from several limitations:
- **Runtime Restrictions:** Maximum runtime of approximately 50 seconds per invocation.
- **Stability Issues:** Frequent function shutdowns during processing.
- **Scalability Concerns:** Difficulty handling multiple concurrent users.

Migrating to GCP Cloud Functions (2nd gen) offers up to 60-minute runtimes, significantly enhancing reliability and scalability. Additionally, a dedicated queuing system will be introduced to manage both script generation and audio processing jobs efficiently.

---

## Goals and Non-Goals

### Goals
- **Concurrent Processing:** Enable simultaneous processing of podcast script generation and audio processing for multiple users.
- **Improved Reliability:** Enhance the reliability of podcast audio generation, reducing timeouts and processing failures.
- **Scalability:** Support 10-15+ concurrent users with efficient job queuing and management.
- **Seamless Integration:** Maintain compatibility with existing Supabase storage, database, and edge functions.
- **Simplified Architecture:** Streamline the processing flow while ensuring scalability for future growth.
- **Robust Queuing:** Implement a queuing system for both script generation and audio processing to manage high concurrency.
- **Seamless Output:** Ensure that the final podcast audio feels continuous, with no abrupt transitions between segments.

### Non-Goals
- **Script Generation Redesign:** The logic for podcast script generation will remain unchanged.
- **Migrating Other Components:** Only the audio processing and its associated queuing/connection layers will be migrated.
- **Enterprise-Scale Overhead:** The solution will be tailored for an initial user base of 10-15 concurrent users rather than full-scale enterprise needs.

---

## User Impact

Users will benefit from:
- **Increased Reliability:** More dependable podcast generation with fewer processing errors.
- **Faster Processing:** Reduced end-to-end processing time for podcasts.
- **Consistent Experience:** No visible changes to the user interface or overall experience.
- **Improved Concurrency:** The ability to handle multiple simultaneous requests without degradation of service.

---

## Technical Architecture

### System Components

1. **GCP Cloud Function: PodcastAudioProcessor**
   - **Role:** Replaces the existing `generate-podcast` function.
   - **Runtime:** Up to 60 minutes (2nd gen Cloud Functions).
   - **Functionality:**
     - Processes the entire podcast in a single run.
     - Splits the podcast script into speaker segments, processes them sequentially, combines audio segments, and uploads the final file to Supabase storage.
   - **Integration:** Directly communicates with Supabase for data retrieval, job status updates, and storage operations.

2. **Queuing System for Script Generation & Audio Processing**
   - **Purpose:** Manage incoming jobs from multiple users by enqueuing both script generation and audio processing tasks.
   - **Mechanism:**
     - A dedicated Supabase Edge Function or Pub/Sub topic will be used to enqueue requests.
     - The queuing system differentiates between script generation and audio processing jobs.
     - Jobs are processed sequentially or in parallel based on current load and predefined priority rules.
   - **Benefit:** Prevents overload and ensures smooth handling of concurrent requests.

3. **Supabase Components (Unchanged)**
   - **Database:** Stores job tracking information, metadata, and now also includes status for script generation.
   - **Storage:** Holds the generated audio files.
   - **Edge Functions:** Remain responsible for initial podcast script generation and job initiation.

4. **Connection Layer**
   - **Functionality:**
     - A lightweight Supabase Edge Function enqueues jobs to GCP.
     - A webhook endpoint on GCP receives job requests.
     - Implements rate limiting and prioritization to manage high concurrency.
   - **Security:** Secure communication between Supabase and GCP using service accounts and Secret Manager.

### Database Schema Changes

```sql
ALTER TABLE podcast_jobs
ADD COLUMN processing_mode VARCHAR(50) DEFAULT 'gcp',
ADD COLUMN gcp_job_id VARCHAR(255),
ADD COLUMN processing_started_at TIMESTAMPTZ,
ADD COLUMN processing_completed_at TIMESTAMPTZ,
ADD COLUMN script_status VARCHAR(50) DEFAULT 'pending';

CREATE TABLE processing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID REFERENCES podcast_jobs(id),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  event_type VARCHAR(50),
  message TEXT,
  details JSONB
);
```

---

## Processing Flow

### Standard Processing Flow
1. **Initiation:**  
   - User triggers podcast generation (UI remains unchanged).
   - The existing edge function generates the podcast script.
2. **Queuing:**  
   - A Supabase edge function enqueues the job into the queuing system (for both script generation and audio processing).
3. **Processing in GCP:**  
   - The GCP Cloud Function receives the job request via a webhook.
   - The function splits the generated script into speaker segments.
   - Processes all segments sequentially.
   - Combines them into a single audio file.
   - Uploads the final audio to Supabase storage.
   - Updates job status and logs processing events.
4. **Notification:**  
   - User receives notification of completion through the existing notification system.

---

## Implementation Plan

### Phase 1: Infrastructure Setup (1 week)
- Configure GCP service accounts and permissions.
- Set up Secret Manager for API keys.
- Create Pub/Sub topics and subscriptions for queuing.
- Deploy a skeleton Cloud Function and basic webhook endpoint.

### Phase 2: Core Development (2 weeks)
- Develop the PodcastAudioProcessor Cloud Function.
- Implement the Supabase-to-GCP connector and queuing mechanism.
- Update the database schema.
- Develop the queuing system for script generation.
- Integrate rate limiting, error handling, and security measures.

### Phase 3: Testing & Validation (1 week)
- Conduct tests with short and long podcast scripts.
- Verify concurrent processing through load testing.
- Optimize performance and resource utilization.

### Phase 4: Deployment & Migration (1 week)
- Deploy the system to production with a feature flag for gradual rollout.
- Monitor processing performance and error rates closely.
- Update documentation and support team training.

---

## Success Metrics

- **Reliability:** 99%+ successful podcast generation rate.
- **Concurrency:** Support for 5+ simultaneous processing jobs.
- **Performance:** Average processing time under 5 minutes per podcast.
- **User Experience:** Zero user-facing errors related to timeouts.
- **Queue Efficiency:** Minimal job queuing latency.

---

## Future Considerations

- **Audio Enhancements:** Background music or sound effects.
- **Advanced Orchestration:** Evaluate Cloud Run for more complex workflows.
- **Dynamic Scaling:** Implement dynamic resource scaling.
- **Feature Expansion:** Personalized podcast intros or post-production editing.

---

This PRD provides a structured approach for migrating podcast audio processing to GCP, ensuring scalability, reliability, and a seamless user experience.

