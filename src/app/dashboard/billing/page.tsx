import { redirect } from 'next/navigation';
import { publicAppPath } from '@/lib/env/public-app-url';

export default function DashboardBillingRedirectPage() {
  redirect(publicAppPath('/dashboard?tab=billing'));
}
