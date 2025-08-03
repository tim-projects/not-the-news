// @filepath: src/main.js

// @refactor-directive
// Refactor JS: concise, modern, functional, same output.

// IMPORTANT: This import is necessary to use Alpine.js with a modular build system like Vite.
// It ensures that the 'Alpine' object is available to this file.
import Alpine from 'alpinejs';

import { rssApp } from './app.js';
// The 'find' command revealed multiple CSS files, so we import them all
import './css/variables.css';
import './css/buttons.css';
import './css/content.css';
import './css/forms.css';
import './css/layout.css';
import './css/modal.css';
import './css/status.css';


// Set up the Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' })
            .then(reg => {
                console.log('Service Worker registered:', reg.scope);

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'activated' && !navigator.serviceWorker.controller) {
                                console.log('New Service Worker activated, but not yet controlling. Reloading...');
                                window.location.reload();
                            }
                        });
                    }
                });
            })
            .catch(error => console.warn('Service Worker registration failed:', error));
    });
}

// Add event listener for lazy-loaded images (moved from app.js)
document.addEventListener("load", e => {
    if (e.target?.tagName?.toLowerCase() === "img") {
        e.target.classList.add("loaded");
    }
}, true);


// Now that Alpine is imported, these calls will work correctly.
Alpine.data('rssApp', rssApp);

// Initialize Alpine.js
Alpine.start();
