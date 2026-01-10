export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PATCH, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, if-none-match',
    'Access-Control-Max-Age': '86400',
};

export function jsonResponse(data: any, status: number = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
        }
    });
}

export function errorResponse(message: string, status: number = 500): Response {
    return jsonResponse({ error: message }, status);
}
