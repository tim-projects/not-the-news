import { describe, it, expect } from 'vitest';
import { compressJson, decompressJson } from '../src/compression';

describe('Compression Utility', () => {
    it('should compress and decompress a JSON object correctly', async () => {
        const originalData = {
            read: ['guid1', 'guid2', 'guid3'],
            timestamp: 1234567890
        };

        const compressed = await compressJson(originalData);
        expect(typeof compressed).toBe('string');
        // Base64 usually doesn't start with {
        expect(compressed.trim().startsWith('{')).toBe(false);

        const decompressed = await decompressJson(compressed);
        expect(decompressed).toEqual(originalData);
    });

    it('should handle large arrays', async () => {
        const largeArray = Array.from({ length: 1000 }, (_, i) => `guid-${i}`);
        const originalData = { list: largeArray };

        const compressed = await compressJson(originalData);
        const decompressed = await decompressJson(compressed);
        expect(decompressed).toEqual(originalData);
    });

    it('should handle raw JSON string (backward compatibility)', async () => {
        const originalData = { legacy: true };
        const jsonString = JSON.stringify(originalData);

        const result = await decompressJson(jsonString);
        expect(result).toEqual(originalData);
    });

    it('should handle invalid input gracefully', async () => {
        const invalid = "not-base64-or-json";
        const result = await decompressJson(invalid);
        // It returns original if parse fails
        expect(result).toBe(invalid); 
    });
});
