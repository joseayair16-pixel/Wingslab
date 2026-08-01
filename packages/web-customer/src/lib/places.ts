export interface PlacesSuggestion {
  name: string;
  description: string;
  place_id: string;
}

interface PlacesCacheEntry {
  query: string;
  results: PlacesSuggestion[];
  at: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 50;

function googleApi(): any {
  return typeof window !== 'undefined' ? (window as any).google : undefined;
}

export function waitForGooglePlaces(timeoutMs = 8000): Promise<any> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const google = googleApi();
      if (google?.maps?.places) return resolve(google);
      if (Date.now() - start > timeoutMs) return resolve(undefined);
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function fetchPlacesFromApi(query: string, countryCode: string): Promise<PlacesSuggestion[]> {
  const google = await waitForGooglePlaces();
  if (!google?.maps?.places) return [];

  const places = google.maps.places;

  if (places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
    try {
      const token = new places.AutocompleteSessionToken();
      const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        sessionToken: token,
        includedRegionCodes: [countryCode],
      });
      return (suggestions || []).map((suggestion: any) => {
        const text = suggestion.placePrediction?.text?.text ?? suggestion.placePrediction?.text?.value ?? '';
        return {
          name: text,
          description: suggestion.placePrediction?.secondaryText?.text ?? '',
          place_id: suggestion.placePrediction?.placeId ?? '',
        };
      });
    } catch {
      // fall through to the classic Places API
    }
  }

  return new Promise((resolve) => {
    const service = new places.AutocompleteService();
    service.getPlacePredictions(
      {
        input: query,
        componentRestrictions: { country: countryCode },
        sessionToken: new places.AutocompleteSessionToken(),
      },
      (predictions: any[] | null, status: any) => {
        if (status !== places.PlacesServiceStatus.OK || !predictions) return resolve([]);
        resolve(
          predictions.map((prediction) => ({
            name: prediction.structured_formatting?.main_text || prediction.description || '',
            description: prediction.structured_formatting?.secondary_text || '',
            place_id: prediction.place_id,
          }))
        );
      }
    );
  });
}

const cache = new Map<string, PlacesCacheEntry>();

function getCached(query: string): PlacesSuggestion[] | undefined {
  const entry = cache.get(query);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(query);
    return undefined;
  }
  return entry.results;
}

function putCache(query: string, results: PlacesSuggestion[]) {
  cache.delete(query);
  cache.set(query, { query, results, at: Date.now() });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function cachedSubset(query: string): PlacesSuggestion[] | undefined {
  const lower = query.toLowerCase();
  let best: { results: PlacesSuggestion[]; len: number } | undefined;

  for (const entry of cache.values()) {
    const other = entry.query.toLowerCase();
    if (other === lower || entry.results.length === 0) continue;
    if (!other.startsWith(lower) && !lower.startsWith(other)) continue;

    const subset = entry.results.filter(
      (r) =>
        (r.name ?? '').toLowerCase().includes(lower) ||
        (r.description ?? '').toLowerCase().includes(lower)
    );
    if (subset.length === 0) continue;
    if (!best || entry.query.length > best.len) {
      best = { results: subset, len: entry.query.length };
    }
  }

  return best?.results;
}

export interface PlacesSourceOptions {
  countryCode?: string;
  debounceMs?: number;
  minLength?: number;
}

export interface PlacesSourceHandlers {
  onResults: (results: PlacesSuggestion[]) => void;
  onBusy?: (busy: boolean) => void;
}

export interface PlacesSource {
  search(query: string, handlers: PlacesSourceHandlers): void;
  cancel(): void;
}

export function createPlacesSource(options: PlacesSourceOptions = {}): PlacesSource {
  const { countryCode = 'mx', debounceMs = 350, minLength = 3 } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestQuery = '';
  let seq = 0;

  function search(query: string, handlers: PlacesSourceHandlers) {
    const { onResults, onBusy } = handlers;
    const trimmed = query.trim();
    const mySeq = ++seq;
    latestQuery = trimmed;

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (trimmed.length < minLength) {
      onBusy?.(false);
      onResults([]);
      return;
    }

    const exact = getCached(trimmed);
    if (exact) {
      onBusy?.(false);
      onResults(exact);
      return;
    }

    const subset = cachedSubset(trimmed);
    if (subset) onResults(subset);

    onBusy?.(true);
    timer = setTimeout(async () => {
      try {
        const results = await fetchPlacesFromApi(trimmed, countryCode);
        if (mySeq !== seq) return;
        putCache(trimmed, results);
        onResults(results);
      } catch (err) {
        console.error('Error searching address:', err);
        if (mySeq === seq) onResults([]);
      } finally {
        if (mySeq === seq) onBusy?.(false);
      }
    }, debounceMs);
  }

  function cancel() {
    seq += 1;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { search, cancel };
}
