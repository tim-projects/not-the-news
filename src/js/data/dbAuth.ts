import { auth } from '../firebase';

/**
 * Retrieves the Firebase ID token for the currently logged-in user.
 * Includes a small retry loop to handle the race condition during app initialization.
 * @returns {Promise<string | null>} The ID token or null if not logged in.
 */
export async function getAuthToken(maxRetries = 10): Promise<string | null> {
    let retries = 0;
    while (retries < maxRetries) {
        const user = auth.currentUser;
        if (user) {
            try {
                return await user.getIdToken();
            } catch (e) {
                console.error("[Auth] Failed to get ID token:", e);
            }
        }
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 200));
        retries++;
    }
    console.warn(`[Auth] Could not obtain token after ${maxRetries} attempts.`);
    return null;
}
