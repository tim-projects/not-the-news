import { jsonResponse, errorResponse } from '../utils/response.ts';

export function handleTimeRequest(): Response {
    const now = new Date();
    return jsonResponse({ time: now.toISOString(), timestamp: now.getTime() });
}

export function handleLoginRequest(): Response {
    return errorResponse('Use Firebase Auth', 410);
}
