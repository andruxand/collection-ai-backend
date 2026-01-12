// Shared config helpers for local scripts (seeding, onboarding, etc.)
// Keep SERVICE_NAME in sync with `service` in serverless.ts.

const SERVICE_NAME = 'collections-ai-mvp';

function getStage() {
  return process.env.STAGE || 'dev';
}

function getRegion() {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
}

function getTableName() {
  const stage = getStage();
  return `${SERVICE_NAME}-${stage}-core`;
}

module.exports = {
  SERVICE_NAME,
  getStage,
  getRegion,
  getTableName,
};
