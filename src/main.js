// src/main.js

import Alpine from './libs/alpine.3.x.x.js';
import { rssApp } from './app.js';
import './css/style.css';

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


// IMPORTANT: Define the Alpine component and then start Alpine
Alpine.data('rssApp', rssApp);

// Initialize Alpine.js
Alpine.start();
