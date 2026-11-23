import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { VisitorLegalDocumentView, visitorLegalRobots } from '@/app/v/visitor-legal-document'
import { loadVisitorLegalPage } from '@/lib/legal/load-visitor-legal-page'
import { visitorLegalPagesEnabled } from '@/lib/legal/visitor-legal-flag'

export const dynamic = 'force-dynamic'

type PrivacyVersionPageProps = {
  params: Promise<{ slug: string; version: string }>
}

export async function generateMetadata({ params }: PrivacyVersionPageProps): Promise<Metadata> {
  if (!visitorLegalPagesEnabled()) {
    return { title: 'Not found', robots: { index: false, follow: false } }
  }
  const { slug, version } = await params
  const loaded = await loadVisitorLegalPage({ kind: 'privacy', slug, version })
  if (!loaded.ok) return { title: 'Not found', robots: { index: false, follow: false } }
  return {
    title: loaded.document.title,
    robots: visitorLegalRobots(loaded.document.status),
  }
}

export default async function VisitorPrivacyVersionPage({ params }: PrivacyVersionPageProps) {
  if (!visitorLegalPagesEnabled()) notFound()
  const { slug, version } = await params
  const loaded = await loadVisitorLegalPage({ kind: 'privacy', slug, version })
  if (!loaded.ok) notFound()
  return <VisitorLegalDocumentView document={loaded.document} />
}
