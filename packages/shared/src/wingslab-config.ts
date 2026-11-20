import { assertOrigin } from './wingslab-policy';

/** Re-enable each external browser provider only after independent configuration/review. */
export function wingslabExternalServicesEnabled(): boolean { return false; }

/** Maps is opt-in independently; enabling it never enables unrelated providers. */
export function wingslabGoogleMapsEnabled(): boolean {
  return process.env.WINGSLAB_GOOGLE_MAPS_ENABLED === 'true' &&
    Boolean(process.env.WINGSLAB_GOOGLE_MAPS_API_KEY?.trim());
}

export function getWingslabApiUrl(): string {
  // Server rendering must not loop back to the frontend container itself.
  // This variable is never exposed through Next's public env configuration.
  if (typeof window === 'undefined' && process.env.WINGSLAB_INTERNAL_API_URL) {
    return assertOrigin(process.env.WINGSLAB_INTERNAL_API_URL, 'internalApi', 'container');
  }
  return assertOrigin(process.env.NEXT_PUBLIC_API_URL, 'backend');
}

export function getWingslabSocketUrl(): string {
  return assertOrigin(process.env.NEXT_PUBLIC_SOCKET_URL, 'backend');
}

export function getWingslabCustomerUrl(): string {
  return assertOrigin(process.env.NEXT_PUBLIC_CUSTOMER_URL, 'customer');
}

export function getWingslabSiteUrl(): string {
  return assertOrigin(process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_WINGSLAB_ROLE || '');
}
