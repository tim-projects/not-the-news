import { AppState, MappedFeedItem } from '@/types/app.ts';

/**
 * TTS Manager
 * Handles Text-to-Speech with word-by-word highlighting and browser compatibility workarounds.
 */

let keepAliveInterval: any = null;

/**
 * Extracts clean, speakable text from HTML content.
 * @param html The HTML string to clean.
 * @returns Clean text suitable for TTS.
 */
function getCleanText(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
}

/**
 * Pre-processes an item's description to wrap words in spans for highlighting.
 * @param html The original HTML description.
 * @returns HTML with words wrapped in <span class="tts-word" data-word-index="N">
 */
export function wrapWordsInSpans(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let wordCount = 0;

    const processNode = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const words = node.textContent?.split(/(\s+)/) || [];
            const fragment = document.createDocumentFragment();
            words.forEach(w => {
                if (w.trim().length > 0) {
                    const span = document.createElement('span');
                    span.classList.add('tts-word');
                    span.dataset.wordIndex = wordCount.toString();
                    span.textContent = w;
                    fragment.appendChild(span);
                    wordCount++;
                } else {
                    fragment.appendChild(document.createTextNode(w));
                }
            });
            node.parentNode?.replaceChild(fragment, node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            Array.from(node.childNodes).forEach(processNode);
        }
    };

    Array.from(doc.body.childNodes).forEach(processNode);
    return doc.body.innerHTML;
}

/**
 * Main TTS entry point.
 */
export function speakItem(app: AppState, guid: string): void {
    if (app.speakingGuid === guid) {
        console.log(`[TTS] Stopping speech for ${guid}`);
        stopSpeech(app);
        return;
    }

    const entry = app.entries.find(e => e.guid === guid);
    if (!entry) return;

    // Stop any existing speech
    stopSpeech(app);

    // Clean up any other highlights
    app.entries.forEach(e => {
        if ((e as any)._originalDescription) {
            e.description = (e as any)._originalDescription;
        }
    });

    app.speakingGuid = guid;

    // Store original description if not already stored
    if (!(entry as any)._originalDescription) {
        (entry as any)._originalDescription = entry.description;
    }

    // 1. Prepare visual description with word spans
    entry.description = wrapWordsInSpans((entry as any)._originalDescription);

    // 2. Prepare text for the engine
    // We want: "Title. Description text."
    const cleanDescription = getCleanText((entry as any)._originalDescription);
    const textToSpeak = `${entry.title}. ${cleanDescription}`.replace(/\s+/g, ' ').trim();

    console.log(`[TTS] Speaking item: ${entry.title.substring(0, 30)}...`);

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    
    // Voice Selection
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural'))) 
                         || voices.find(v => v.lang.startsWith('en'))
                         || voices[0];
    
    if (preferredVoice) {
        console.log(`[TTS] Voice: ${preferredVoice.name}`);
        utterance.voice = preferredVoice;
    }

    // Highlighting Logic
    utterance.onboundary = (event) => {
        if (event.name === 'word') {
            const charIndex = event.charIndex;
            const textBefore = textToSpeak.substring(0, charIndex);
            const currentWordIndex = (textBefore.match(/\S+/g) || []).length;
            
            requestAnimationFrame(() => {
                const container = document.querySelector(`.entry[data-guid="${guid}"] .itemdescription`);
                if (container) {
                    container.querySelectorAll('.tts-highlight').forEach(el => el.classList.remove('tts-highlight'));
                    const wordEl = container.querySelector(`.tts-word[data-word-index="${currentWordIndex}"]`);
                    if (wordEl) {
                        wordEl.classList.add('tts-highlight');
                    }
                }
            });
        }
    };

    utterance.onstart = () => console.log('[TTS] Audio started');
    
    utterance.onend = () => {
        console.log('[TTS] Audio finished');
        if (app.speakingGuid === guid) {
            finalizeSpeech(app, entry);
        }
    };

    utterance.onerror = (err) => {
        console.error('[TTS] Engine error:', err.error);
        if (app.speakingGuid === guid) {
            finalizeSpeech(app, entry);
        }
    };

    // Compatibility fixes for Brave/Chrome/Android
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    
    window.speechSynthesis.cancel(); // Force clear queue
    window.speechSynthesis.resume(); // Unpause engine if stuck
    
    // Small delay before speak often helps Android
    setTimeout(() => {
        window.speechSynthesis.speak(utterance);
        
        // Chrome/Brave keep-alive
        keepAliveInterval = setInterval(() => {
            if (!app.speakingGuid) {
                clearInterval(keepAliveInterval);
                return;
            }
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
            }
        }, 10000);
    }, 50);
}

/**
 * Stops all speech and cleans up.
 */
export function stopSpeech(app: AppState): void {
    window.speechSynthesis.cancel();
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    
    if (app.speakingGuid) {
        const entry = app.entries.find(e => e.guid === app.speakingGuid);
        if (entry) finalizeSpeech(app, entry);
    }
}

/**
 * Internal cleanup for a specific entry.
 */
function finalizeSpeech(app: AppState, entry: MappedFeedItem): void {
    app.speakingGuid = null;
    if ((entry as any)._originalDescription) {
        entry.description = (entry as any)._originalDescription;
    }
    // Final UI cleanup of highlights
    const container = document.querySelector(`.entry[data-guid="${entry.guid}"] .itemdescription`);
    if (container) {
        container.querySelectorAll('.tts-highlight').forEach(el => el.classList.remove('tts-highlight'));
    }
}
