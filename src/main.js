// src/main.js

// Import all your CSS files
import './css/variables.css';
import './css/buttons.css';
import './css/forms.css';
import './css/layout.css';
import './css/content.css';
import './css/modal.css';

// Import your application's logic
import './js/app.js';
import './js/libs/idb.js';
import './js/data/dbCore.js';
import './js/data/dbSyncOperations.js';
import './js/data/dbUserState.js';
import './js/data/database.js';
import './js/ui/uiInitializers.js';
import './js/ui/uiElements.js';
import './js/ui/uiUpdaters.js';
import './js/helpers/deckManager.js';
import './js/helpers/apiUtils.js';
import './js/helpers/dataUtils.js';
import './js/helpers/userStateUtils.js';

// Import the libraries from the public directory
import Alpine from '../public/js/libs/alpine.3.x.x.js';
import RSSParser from '../public/js/libs/rss-parser.min.js';

// The Alpine.js component must be defined globally before it's used
// in the HTML. Assuming your app.js exports the 'rssApp' object and 'initApp' method.
// You'll need to modify app.js to export these
import { rssApp, initApp } from './js/app.js';

// Initialize Alpine.js
window.Alpine = Alpine;
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', rssApp);
    // You can also define global functions if needed
    // Alpine.store('app', {
    //     initApp: initApp
    // });
});
Alpine.start();

// Make RSSParser globally available if other scripts need it
window.RSSParser = RSSParser;