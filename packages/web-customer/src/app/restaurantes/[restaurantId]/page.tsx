import { notFound, redirect } from 'next/navigation';
import { WINGSLAB_BUSINESS } from '@sadel/shared';

/** Compatibility only. The business cannot be selected through a URL. */
export default async function LegacyRestaurantLink({ params, searchParams }: {
  params: Promise<{ restaurantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await params).restaurantId !== WINGSLAB_BUSINESS.restaurantId) notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string' && ['checkout', 'fulfillment', 'orderId'].includes(key)) query.set(key, value);
  }
  redirect('/' + (query.size ? `?${query}` : ''));
}
