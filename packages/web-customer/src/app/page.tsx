import Storefront from './restaurantes/[restaurantId]/Storefront';
export const dynamic = 'force-dynamic';

export default function WingsLabPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Storefront searchParams={searchParams} />;
}
