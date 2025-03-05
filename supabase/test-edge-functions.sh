#!/bin/bash

# Test Supabase Edge Functions
# This script tests both the enqueue-podcast-job and check-podcast-status functions

SUPABASE_PROJECT_REF="vrsbermuilpkvjdnnhtf"
ENQUEUE_FUNCTION_URL="https://${SUPABASE_PROJECT_REF}.functions.supabase.co/enqueue-podcast-job"
CHECK_STATUS_FUNCTION_URL="https://${SUPABASE_PROJECT_REF}.functions.supabase.co/check-podcast-status"

echo "Testing Supabase Edge Functions"
echo "Project Reference: $SUPABASE_PROJECT_REF"
echo "Enqueue Function URL: $ENQUEUE_FUNCTION_URL"
echo "Check Status Function URL: $CHECK_STATUS_FUNCTION_URL"

# Get auth token - this is required for actual testing
echo "Enter your Supabase JWT token (required for testing):"
echo "You can get this from your browser's local storage in the Supabase dashboard."
echo "Look for 'supabase.auth.token' and copy the access_token."
read JWT_TOKEN

if [ -z "$JWT_TOKEN" ]; then
  echo "Error: JWT token is required for testing Supabase Edge Functions."
  exit 1
fi

# Generate test data with unique identifiers
TEST_ARTICLE_ID="test-article-$(date +%s)"

# Test data for enqueue function
ENQUEUE_DATA=$(cat <<EOF
{
  "articles": [
    {
      "id": "${TEST_ARTICLE_ID}",
      "title": "Test Article Title",
      "content": "This is a test article content for testing the Supabase Edge Functions. It demonstrates the new processing pipeline using GCP Cloud Functions."
    }
  ]
}
EOF
)

echo "=== TESTING ENQUEUE PODCAST JOB FUNCTION ==="
echo "Sending request with data:"
echo "$ENQUEUE_DATA" | jq .

# Call the enqueue-podcast-job function
echo "Calling enqueue-podcast-job function..."
ENQUEUE_RESPONSE=$(curl -s -X POST "$ENQUEUE_FUNCTION_URL" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$ENQUEUE_DATA")

echo "Response:"
echo "$ENQUEUE_RESPONSE" | jq .

# Extract job ID from the response
JOB_ID=$(echo "$ENQUEUE_RESPONSE" | jq -r '.job_id')

if [ "$JOB_ID" == "null" ] || [ -z "$JOB_ID" ]; then
  echo "Error: Failed to get job ID from enqueue function response."
  exit 1
fi

echo "Job ID: $JOB_ID"

# Test the check-podcast-status function
echo ""
echo "=== TESTING CHECK PODCAST STATUS FUNCTION ==="
echo "Calling check-podcast-status function with job ID: $JOB_ID"

CHECK_RESPONSE=$(curl -s -X GET "$CHECK_STATUS_FUNCTION_URL?job_id=$JOB_ID" \
  -H "Authorization: Bearer $JWT_TOKEN")

echo "Response:"
echo "$CHECK_RESPONSE" | jq .

echo ""
echo "Tests complete!"
echo "You can check the status of job ID: $JOB_ID again later using:"
echo "curl -X GET \"$CHECK_STATUS_FUNCTION_URL?job_id=$JOB_ID\" -H \"Authorization: Bearer YOUR_JWT_TOKEN\"" 