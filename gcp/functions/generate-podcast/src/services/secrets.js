/**
 * Secrets management service for accessing GCP Secret Manager
 */
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// Secret Manager client for accessing secrets
const secretManagerClient = new SecretManagerServiceClient();

/**
 * Helper function to access secrets from GCP Secret Manager
 * @param {string} secretName - Name of the secret to access
 * @returns {Promise<string>} Secret value
 */
async function accessSecret(secretName) {
  const name = `projects/supabase-451007/secrets/${secretName}/versions/latest`;
  console.log("Accessing secret:", name);
  const [version] = await secretManagerClient.accessSecretVersion({ name });
  return version.payload.data.toString();
}

module.exports = {
  accessSecret
}; 