/**
 * Compression Utility for Large JSON Payloads
 * Uses native CompressionStream (Gzip) and Base64 encoding.
 */

/**
 * Compresses a JSON-serializable object into a Base64-encoded Gzip string.
 * @param data The object to compress.
 * @returns A promise that resolves to the compressed Base64 string.
 */
export async function compressJson(data: any): Promise<string> {
    const jsonString = JSON.stringify(data);
    const stream = new Blob([jsonString]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const response = new Response(compressedStream);
    const blob = await response.blob();
    return blobToBase64(blob);
}

/**
 * Decompresses a Base64-encoded Gzip string back into a JSON object.
 * @param base64String The compressed Base64 string.
 * @returns A promise that resolves to the decompressed object.
 */
export async function decompressJson(base64String: string): Promise<any> {
    // If the string doesn't look like base64 or isn't compressed, return it as is or try to parse it
    if (!base64String || typeof base64String !== 'string') return base64String;
    
    // Simple heuristic: If it starts with '{' or '[', it's likely not compressed
    if (base64String.trim().startsWith('{') || base64String.trim().startsWith('[')) {
        try {
            return JSON.parse(base64String);
        } catch {
            return base64String;
        }
    }

    try {
        const blob = await base64ToBlob(base64String);
        const stream = blob.stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
        const response = new Response(decompressedStream);
        const text = await response.text();
        return JSON.parse(text);
    } catch (e) {
        console.warn("[Compression] Failed to decompress string, returning original:", e);
        // Fallback: maybe it wasn't compressed?
        try {
            return JSON.parse(base64String);
        } catch {
            return base64String;
        }
    }
}

/**
 * Helper: Convert Blob to Base64 string.
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:application/octet-stream;base64,")
            const base64 = result.split(',')[1]; 
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Helper: Convert Base64 string to Blob.
 */
async function base64ToBlob(base64: string): Promise<Blob> {
    const response = await fetch(`data:application/octet-stream;base64,${base64}`);
    return response.blob();
}
