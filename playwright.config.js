// playwright.config.js
module.exports = {
  timeout: 60000,
  use: {
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: ['--allow-insecure-localhost'],
    },
  },
};