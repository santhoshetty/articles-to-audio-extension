# Deployment Guide for Generate Podcast

This document provides detailed instructions for deploying the generate podcast function to Google Cloud Platform (GCP) Cloud Functions.

## 1. Install Google Cloud SDK

### Option 1: Install with Homebrew (macOS)
```bash
brew install --cask google-cloud-sdk
```

### Option 2: Download and install from Google's website
1. Download the installer from [Google Cloud SDK Installation Page](https://cloud.google.com/sdk/docs/install-sdk)
2. Follow the installation instructions for your operating system

### Initialize Google Cloud SDK
```bash
gcloud init
```
Follow the prompts to authenticate with your Google account and select your GCP project.

## 2. Set up Secrets in Secret Manager

Create the required secrets in GCP Secret Manager:

```bash
# Replace YOUR_PROJECT_ID with your actual GCP project ID
export PROJECT_ID=YOUR_PROJECT_ID

# Create secrets
gcloud secrets create openai-api-key --project=$PROJECT_ID
gcloud secrets create supabase-url --project=$PROJECT_ID
gcloud secrets create supabase-service-key --project=$PROJECT_ID

# Add secret versions with the actual values
echo -n "your-openai-api-key" | gcloud secrets versions add openai-api-key --data-file=- --project=$PROJECT_ID
echo -n "your-supabase-url" | gcloud secrets versions add supabase-url --data-file=- --project=$PROJECT_ID
echo -n "your-supabase-service-key" | gcloud secrets versions add supabase-service-key --data-file=- --project=$PROJECT_ID
```

## 3. Grant Secret Manager Access to the Cloud Function Service Account

```bash
# Grant the Cloud Function service account access to Secret Manager
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 4. Install Dependencies and Build

Navigate to the Cloud Function directory and install dependencies:

```bash
cd gcp/functions/generate-podcast
npm install
```

## 5. Deploy the Cloud Function

```bash
# Deploy the Cloud Function
npm run deploy
```

This will run the deployment script defined in `package.json`, which is:

```bash
gcloud functions deploy generate-podcast \
  --gen2 \
  --runtime=nodejs18 \
  --region=us-central1 \
  --source=. \
  --entry-point=processPodcastAudio \
  --trigger-http \
  --timeout=3600s \
  --set-env-vars PROJECT_ID=$PROJECT_ID
```

## 6. Get the Cloud Function URL

```bash
gcloud functions describe generate-podcast \
  --gen2 \
  --region=us-central1 \
  --format="value(serviceConfig.uri)" \
  --project=$PROJECT_ID
```

Copy the output URL, as you'll need it for the Supabase Edge Function configuration.

## 7. Test the Cloud Function

You can test the Cloud Function using `curl` or any other HTTP client:

```bash
curl -X POST https://FUNCTION_URL \
  -H "Content-Type: application/json" \
  -d '{
    "articles": [
      {
        "id": "article-id",
        "title": "Article Title",
        "content": "Article content..."
      }
    ],
    "jobId": "test-job-id",
    "userId": "test-user-id",
    "authToken": "test-auth-token"
  }'
```

## 8. Monitoring and Logs

You can view the Cloud Function logs in the GCP Console:

```bash
gcloud functions logs read generate-podcast \
  --gen2 \
  --region=us-central1 \
  --project=$PROJECT_ID
```

Or through the [GCP Console Cloud Functions Dashboard](https://console.cloud.google.com/functions). 