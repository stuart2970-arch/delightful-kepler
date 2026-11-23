import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { visitorLegalPagesEnabled } from '@/lib/legal/visitor-legal-flag'
import { VISITOR_TERMS_STATUS } from '@/lib/legal/visitor-templates/terms'
import { visitorLegalRobots } from '@/app/v/visitor-legal-document'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return {
    robots: visitorLegalRobots(VISITOR_TERMS_STATUS),
  }
}

export default function VisitorLegalLayout({ children }: { children: ReactNode }) {
  if (!visitorLegalPagesEnabled()) notFound()
  return children
}
