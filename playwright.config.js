// playwright.config.js
module.exports = {
  timeout: 60000,
  use: {
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--allow-insecure-localhost'],
    },
  },
};