import { redirect } from 'next/navigation';

export default function DashboardBillingRedirectPage() {
  const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';
  const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';
  redirect(wpAppUrl);
}
