#!/bin/bash

# Test the GCP Cloud Function directly
# This script sends a direct request to the GCP Cloud Function

GCP_FUNCTION_URL="https://us-central1-supabase-451007.cloudfunctions.net/generate-podcast"

echo "Testing GCP Cloud Function at $GCP_FUNCTION_URL"

# Generate a test article with unique ID
TEST_ARTICLE_ID="test-article-$(date +%s)"
# Generate a random UUID for the job ID
TEST_JOB_ID=$(uuidgen || (echo "uuidgen not found, using fallback" && python3 -c "import uuid; print(uuid.uuid4())"))
TEST_USER_ID=$(uuidgen || (echo "uuidgen not found, using fallback" && python3 -c "import uuid; print(uuid.uuid4())"))

# Get Supabase auth token - for testing purposes only
# In production, this would be a real JWT token from the Supabase client
echo "Enter your Supabase auth token (or press Enter to use a dummy token):"
read SUPABASE_AUTH_TOKEN
if [ -z "$SUPABASE_AUTH_TOKEN" ]; then
  SUPABASE_AUTH_TOKEN="dummy-auth-token-for-testing"
  echo "Using dummy Supabase token. Note: This will likely fail authentication."
fi

# Get a GCP identity token for authenticating with the Cloud Function
echo "Getting GCP identity token for authentication..."
GCP_TOKEN=$(gcloud auth print-identity-token)

if [ -z "$GCP_TOKEN" ]; then
  echo "Failed to get GCP token. Make sure you're logged in with 'gcloud auth login'"
  echo "Trying without GCP authentication (will likely fail)..."
else
  echo "Successfully obtained GCP token"
fi

# Test data
TEST_DATA=$(cat <<EOF
{
  "articles": [
    {
      "id": "${TEST_ARTICLE_ID}",
      "title": "Test Article Title",
      "content": "This is a test article content for testing the GCP Cloud Function. It demonstrates the direct HTTP test of the Cloud Function deployed on Google Cloud Platform."
    }
  ],
  "jobId": "${TEST_JOB_ID}",
  "userId": "${TEST_USER_ID}",
  "authToken": "${SUPABASE_AUTH_TOKEN}"
}
EOF
)

echo "Sending request with data:"
echo "$TEST_DATA" | jq .

# Set up the authentication header if we have a token
if [ -n "$GCP_TOKEN" ]; then
  AUTH_HEADER="Authorization: Bearer $GCP_TOKEN"
  echo "Using GCP authentication header"
else
  AUTH_HEADER=""
  echo "No authentication header (will likely fail)"
fi

# Send request to GCP Cloud Function with verbose output
echo "Detailed response with headers:"
curl -v -X POST "$GCP_FUNCTION_URL" \
  -H "Content-Type: application/json" \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  -d "$TEST_DATA"

echo -e "\n\nTrying to parse as JSON:"
curl -X POST "$GCP_FUNCTION_URL" \
  -H "Content-Type: application/json" \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  -d "$TEST_DATA" \
  | jq . || echo "Failed to parse response as JSON"

echo "Test complete!" 