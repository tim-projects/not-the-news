/**
 * Compression Utility for Large JSON Payloads
 * Uses native CompressionStream (Gzip) and standard Base64 encoding.
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
    const arrayBuffer = await blob.arrayBuffer();
    return arrayBufferToBase64(arrayBuffer);
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
        const arrayBuffer = base64ToArrayBuffer(base64String);
        const stream = new Blob([arrayBuffer]).stream();
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
 * Helper: Convert ArrayBuffer to Base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Helper: Convert Base64 string to ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}
