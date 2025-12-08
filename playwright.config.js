// playwright.config.js
module.exports = {
  timeout: 60000,
  retries: 1, // Add this line to enable retries
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry', // Add this line
    launchOptions: {
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--allow-insecure-localhost'],
    },
  },
};
