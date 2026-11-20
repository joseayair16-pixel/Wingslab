import { ensureGoogleMapsScript } from './googleMaps';

export interface PlacesSuggestion {
  name: string;
  description: string;
  place_id: string;
  /** Keep the transient prediction so toPlace() carries the autocomplete session token. */
  placePrediction?: any;
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

let activeSessionToken: any = null;

export async function fetchSelectedPlaceFields(suggestion: PlacesSuggestion, fields: string[]): Promise<any> {
  const prediction = suggestion.placePrediction;
  if (!prediction?.toPlace) throw new Error('Selected result is not a Places prediction');
  const place = prediction.toPlace();
  try {
    await place.fetchFields({ fields });
    return place;
  } finally {
    activeSessionToken = null;
  }
}

async function fetchPredictions(query: string, countryCode: string, token: any): Promise<PlacesSuggestion[]> {
  const google = await ensureGoogleMapsScript();
  if (!google) return [];
  const places = await google.maps.importLibrary('places');
  const result = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: query,
    sessionToken: token,
    includedRegionCodes: [countryCode],
  });
  return (result.suggestions || []).slice(0, 5).flatMap((suggestion: any) => {
    const prediction = suggestion.placePrediction;
    if (!prediction?.placeId) return [];
    const text = prediction.text?.text ?? prediction.text?.value ?? '';
    return [{
      name: text,
      description: prediction.secondaryText?.text ?? '',
      place_id: prediction.placeId,
      placePrediction: prediction,
    }];
  });
}

export function createPlacesSource(options: PlacesSourceOptions = {}): PlacesSource {
  const { countryCode = 'mx', debounceMs = 500, minLength = 4 } = options;
  const minRequestIntervalMs = 1200;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  let lastRequestAt = 0;
  let busyHandlers: PlacesSourceHandlers | null = null;

  function search(query: string, handlers: PlacesSourceHandlers) {
    const trimmed = query.trim();
    const requestSeq = ++seq;
    if (timer) clearTimeout(timer);
    timer = null;
    if (busyHandlers && busyHandlers !== handlers) busyHandlers.onBusy?.(false);
    busyHandlers = handlers;

    if (trimmed.length < minLength) {
      activeSessionToken = null;
      handlers.onBusy?.(false);
      handlers.onResults([]);
      return;
    }

    handlers.onBusy?.(true);
    const delay = Math.max(debounceMs, minRequestIntervalMs - (Date.now() - lastRequestAt));
    timer = setTimeout(async () => {
      timer = null;
      try {
        const google = await ensureGoogleMapsScript();
        if (!google) throw new Error('Google Maps is not enabled');
        const places = await google.maps.importLibrary('places');
        activeSessionToken ||= new places.AutocompleteSessionToken();
        lastRequestAt = Date.now();
        const results = await fetchPredictions(trimmed, countryCode, activeSessionToken);
        if (requestSeq === seq) handlers.onResults(results);
      } catch {
        if (requestSeq === seq) handlers.onResults([]);
      } finally {
        if (requestSeq === seq) handlers.onBusy?.(false);
      }
    }, delay);
  }

  function cancel() {
    seq += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    activeSessionToken = null;
    busyHandlers?.onBusy?.(false);
    busyHandlers = null;
  }

  return { search, cancel };
}
