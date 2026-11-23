import type { Metadata } from 'next'
import type { VisitorLegalDocument } from '@/lib/legal/render-visitor-legal'

export function visitorLegalRobots(status: 'DRAFT' | 'PUBLISHED'): Metadata['robots'] {
  if (status === 'DRAFT') return { index: false, follow: false }
  return { index: true, follow: true }
}

export function VisitorLegalDocumentView({ document }: { document: VisitorLegalDocument }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-gray-900">
      {document.banner ? (
        <p
          data-testid="visitor-legal-draft-banner"
          role="status"
          className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
        >
          {document.banner}
        </p>
      ) : null}
      <article
        data-testid="visitor-legal-article"
        aria-label={document.title}
        className="[&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_a]:underline [&_table]:mt-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_th]:border-gray-200 [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-2 [&_td]:align-top"
        dangerouslySetInnerHTML={{ __html: document.html }}
      />
    </main>
  )
}
