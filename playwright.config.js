// playwright.config.js
module.exports = {
  testDir: './tests', // Specify the directory where tests are located
  outputDir: './test-results', // Specify the directory for test results
  timeout: 90000,
  retries: 1, // Add this line to enable retries
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry', // Add this line
    actionTimeout: 30000,
    navigationTimeout: 60000,
  },
};
