export function generateStaticParams() {
  return [{ token: 'placeholder' }];
}

export default function DeliveryTicketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
