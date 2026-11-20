import { createPlacesSource, fetchSelectedPlaceFields } from './places';
import { ensureGoogleMapsScript } from './googleMaps';

jest.mock('./googleMaps', () => ({ ensureGoogleMapsScript: jest.fn() }));

describe('Places request pacing and sessions', () => {
  const ensureMaps = ensureGoogleMapsScript as jest.MockedFunction<typeof ensureGoogleMapsScript>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    ensureMaps.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces, spaces requests, keeps one session token and completes it via the selected prediction', async () => {
    const token = {};
    const selectedPlace = { fetchFields: jest.fn().mockResolvedValue(undefined) };
    const prediction = {
      placeId: 'place-id',
      text: { text: 'Calle ejemplo' },
      toPlace: jest.fn(() => selectedPlace),
    };
    const autocomplete = jest.fn().mockResolvedValue({
      suggestions: [{ placePrediction: prediction }],
    });
    const placesLibrary = {
      AutocompleteSessionToken: jest.fn(() => token),
      AutocompleteSuggestion: { fetchAutocompleteSuggestions: autocomplete },
    };
    const google = { maps: { importLibrary: jest.fn().mockResolvedValue(placesLibrary) } };
    ensureMaps.mockResolvedValue(google as any);

    const source = createPlacesSource();
    const onResults = jest.fn();
    const handlers = { onResults, onBusy: jest.fn() };
    source.search('abc', handlers);
    expect(onResults).toHaveBeenLastCalledWith([]);
    source.search('abcd', handlers);
    await jest.advanceTimersByTimeAsync(499);
    expect(autocomplete).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(autocomplete).toHaveBeenCalledTimes(1);
    expect(onResults.mock.lastCall?.[0]).toHaveLength(1);

    source.search('abcde', handlers);
    await jest.advanceTimersByTimeAsync(1199);
    expect(autocomplete).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(autocomplete).toHaveBeenCalledTimes(2);
    expect(autocomplete.mock.calls[0][0].sessionToken).toBe(token);
    expect(autocomplete.mock.calls[1][0].sessionToken).toBe(token);

    const place = await fetchSelectedPlaceFields(onResults.mock.lastCall?.[0][0], ['location']);
    expect(place).toBe(selectedPlace);
    expect(prediction.toPlace).toHaveBeenCalledTimes(1);
    expect(selectedPlace.fetchFields).toHaveBeenCalledWith({ fields: ['location'] });
    source.cancel();
  });
});
