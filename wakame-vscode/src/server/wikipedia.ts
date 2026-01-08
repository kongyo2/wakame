/**
 * Wikipedia integration for fetching article summaries
 */

import type { WikipediaCacheEntry } from '../shared/types.js';

// Cache for Wikipedia lookups (in-memory)
const cache = new Map<string, WikipediaCacheEntry>();

// Cache expiry time: 1 hour
const CACHE_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Fetch Wikipedia summary for a term
 * Uses the Japanese Wikipedia API
 */
export async function fetchWikipediaSummary(
  term: string
): Promise<string | null> {
  // Check cache first
  const cached = cache.get(term);
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
    return cached.summary;
  }

  try {
    // Use Wikipedia REST API for summary
    const encodedTerm = encodeURIComponent(term);
    const url = `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodedTerm}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Wakame-VSCode/0.1.0 (Japanese LSP Extension)',
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      // Not found - cache this result
      cache.set(term, {
        summary: null,
        status: 'not_found',
        timestamp: Date.now(),
      });
      return null;
    }

    if (!response.ok) {
      // Error - cache temporarily
      cache.set(term, {
        summary: null,
        status: 'error',
        timestamp: Date.now(),
      });
      return null;
    }

    const data = (await response.json()) as { extract?: string };
    const summary = data.extract || null;

    // Cache successful result
    cache.set(term, {
      summary,
      status: 'success',
      timestamp: Date.now(),
    });

    return summary;
  } catch {
    // Network error - don't cache
    return null;
  }
}

/**
 * Clear the Wikipedia cache
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; hits: number; misses: number } {
  return {
    size: cache.size,
    hits: 0, // Would need to track this separately
    misses: 0,
  };
}
