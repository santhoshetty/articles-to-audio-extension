const axios = require('axios');

// Test data
const testData = {
  articles: [
    {
      id: 'test-article-id',
      title: 'Test Article Title',
      content: 'This is a test article content for testing the GCP Cloud Function.'
    }
  ],
  jobId: 'test-job-id',
  userId: 'test-user-id',
  authToken: 'test-auth-token'
};

// Print test data for debugging
console.log('Test data:', JSON.stringify(testData, null, 2));

// URL for local testing
const localUrl = 'http://localhost:8080';

// URL for cloud testing
const cloudUrl = 'https://generate-podcast-pl3brwex7a-uc.a.run.app';

// Function to test the Cloud Function
async function testCloudFunction(url) {
  console.log(`Testing Cloud Function at ${url}...`);
  
  try {
    // Set up tracing for axios to see what's being sent
    console.log('Sending request with data:', JSON.stringify(testData, null, 2));
    
    const response = await axios.post(url, testData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response Status:', response.status);
    console.log('Response Data:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', error.response.data);
    }
    return null;
  }
}

// Test only locally for now
async function runTest() {
  // Test locally only
  console.log('\n========== LOCAL TEST ==========\n');
  await testCloudFunction(localUrl);
  
  // Skip cloud test for now
  // console.log('\n========== CLOUD TEST ==========\n');
  // await testCloudFunction(cloudUrl);
}

runTest(); 