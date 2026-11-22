import { renderBrandedSystemEmail } from '../layout'
import type { SystemEmailTemplate } from '../types'

export type Batch3Field = {
  name: string
  label: string
  required: boolean
}

export type Batch3MassNoticeDefinition = {
  number: number
  key: string
  label: string
  fields: readonly Batch3Field[]
}

const text = (data: Record<string, string>, key: string, fallback: string): string => {
  const raw = data[key]
  if (typeof raw !== 'string') return fallback
  const cleaned = raw.replace(/[\r\n\u0000]+/g, ' ').trim()
  return cleaned || fallback
}

const business = (data: Record<string, string>): string => text(data, 'businessName', 'your business')

/**
 * Mass notices #24–#31. Facts are limited to the Terms, Privacy Policy and
 * DPA redrafts recorded on STYL-171. Notice periods are stated as the
 * clause requires them. The email does not claim the notice was on time.
 */
export const BATCH3_MASS_NOTICES: readonly Batch3MassNoticeDefinition[] = [
  {
    number: 24,
    key: 'system.batch3.sub-processor-change',
    label: 'Sub-processor change',
    fields: [
      { name: 'supplierName', label: 'Supplier', required: true },
      { name: 'supplierRole', label: 'What the supplier does', required: true },
      { name: 'effectiveDate', label: 'Start date', required: true },
    ],
  },
  {
    number: 25,
    key: 'system.batch3.service-change',
    label: 'Service change',
    fields: [
      { name: 'changeSummary', label: 'What is being reduced', required: true },
      { name: 'effectiveDate', label: 'Date the change takes effect', required: true },
    ],
  },
  {
    number: 26,
    key: 'system.batch3.urgent-change',
    label: 'Urgent change',
    fields: [
      { name: 'changeSummary', label: 'What is changing', required: true },
      { name: 'effectiveDate', label: 'Date the change takes effect', required: true },
      { name: 'alternativeOffer', label: 'Alternative, if there is one', required: false },
    ],
  },
  {
    number: 27,
    key: 'system.batch3.terms-change',
    label: 'Terms change',
    fields: [
      { name: 'changeSummary', label: 'What is changing in the Terms', required: true },
      { name: 'effectiveDate', label: 'Date the change takes effect', required: true },
    ],
  },
  {
    number: 28,
    key: 'system.batch3.dpa-change',
    label: 'DPA change',
    fields: [
      { name: 'changeSummary', label: 'What is changing in the DPA', required: true },
      { name: 'effectiveDate', label: 'Date the change takes effect', required: true },
    ],
  },
  {
    number: 29,
    key: 'system.batch3.privacy-change',
    label: 'Privacy Policy change',
    fields: [
      { name: 'changeSummary', label: 'What is changing in the Privacy Policy', required: true },
      { name: 'effectiveDate', label: 'Date the change takes effect', required: true },
    ],
  },
  {
    number: 30,
    key: 'system.batch3.vat-registration',
    label: 'VAT registration',
    fields: [
      { name: 'vatNumber', label: 'VAT registration number', required: true },
      { name: 'effectiveDate', label: 'Date registration takes effect', required: true },
    ],
  },
  {
    number: 31,
    key: 'system.batch3.contract-transfer',
    label: 'Transfer of the contract',
    fields: [
      { name: 'transfereeName', label: 'Who the Terms transfer to', required: true },
      { name: 'effectiveDate', label: 'Date of the transfer', required: true },
    ],
  },
]

const byKey = new Map(BATCH3_MASS_NOTICES.map((notice) => [notice.key, notice]))

export const isBatch3MassTemplateKey = (templateKey: string): boolean => byKey.has(templateKey)

export const batch3MassNoticeDefinition = (templateKey: string): Batch3MassNoticeDefinition | null => {
  return byKey.get(templateKey) ?? null
}

const subProcessor: SystemEmailTemplate = {
  key: 'system.batch3.sub-processor-change',
  sampleData: {
    businessName: 'Harbour Salon',
    supplierName: 'Example Supplier Ltd',
    supplierRole: 'stores conversation transcripts for the assistant',
    effectiveDate: '1 April 2027',
  },
  render(data) {
    const name = business(data)
    return renderBrandedSystemEmail({
      subject: 'Notice of a sub-processor change',
      title: 'StyleFlo',
      subtitle: 'Sub-processor change',
      paragraphs: [
        `Hello,`,
        `We are writing to ${name} about a change to a sub-processor. The Terms (clause 6A.3) and the Data Processing Addendum (clauses 6.2 and 6.4) require this notice at least 14 days before the change.`,
        `Supplier: ${text(data, 'supplierName', 'the supplier named in this notice')}.`,
        `What they do: ${text(data, 'supplierRole', 'the processing described in this notice')}.`,
        `The change starts on ${text(data, 'effectiveDate', 'the date in this notice')}.`,
        `If you object, reply to this email. You may also end the Terms and receive a pro-rata refund of prepaid fees.`,
        `This notice cannot be switched off in your account.`,
      ],
    })
  },
}

const serviceChange: SystemEmailTemplate = {
  key: 'system.batch3.service-change',
  sampleData: {
    businessName: 'Harbour Salon',
    changeSummary: 'the number of included knowledge items is reduced',
    effectiveDate: '1 May 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Notice of a change to the service',
      title: 'StyleFlo',
      subtitle: 'Service change',
      paragraphs: [
        `Hello,`,
        `We are writing to ${business(data)} about a significant reduction in the service. The Terms (clause 6B.2) require at least one month's notice before the change.`,
        `What is being reduced: ${text(data, 'changeSummary', 'the reduction described in this notice')}.`,
        `The change takes effect on ${text(data, 'effectiveDate', 'the date in this notice')}.`,
        `You may cancel and receive a pro-rata refund of prepaid fees.`,
        `This notice cannot be switched off in your account.`,
      ],
    })
  },
}

const urgentChange: SystemEmailTemplate = {
  key: 'system.batch3.urgent-change',
  sampleData: {
    businessName: 'Harbour Salon',
    changeSummary: 'a supplier has withdrawn a channel we use to deliver messages',
    effectiveDate: '20 March 2027',
    alternativeOffer: 'messages can still be taken in web chat',
  },
  render(data) {
    const alternative = text(data, 'alternativeOffer', '')
    return renderBrandedSystemEmail({
      subject: 'Urgent change to the service',
      title: 'StyleFlo',
      subtitle: 'Urgent change',
      paragraphs: [
        `Hello,`,
        `We are writing to ${business(data)} as soon as we can about an urgent change. The Terms (clause 6B.3) require this notice as soon as possible, and an alternative where there is one.`,
        `What is changing: ${text(data, 'changeSummary', 'the change described in this notice')}.`,
        `The change takes effect on ${text(data, 'effectiveDate', 'the date in this notice')}.`,
        alternative
          ? `Alternative we can offer: ${alternative}.`
          : `We do not have an alternative to offer.`,
        `This notice cannot be switched off in your account.`,
      ],
    })
  },
}

const termsChange: SystemEmailTemplate = {
  key: 'system.batch3.terms-change',
  sampleData: {
    businessName: 'Harbour Salon',
    changeSummary: 'the notice period for ending the Terms is lengthened',
    effectiveDate: '1 June 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Notice of a change to the Terms',
      title: 'StyleFlo',
      subtitle: 'Terms change',
      paragraphs: [
        `Hello,`,
        `We are writing to ${business(data)} about a change to the Terms that significantly disadvantages you. Clause 9.1 requires at least one month's notice before that kind of change.`,
        `What is changing: ${text(data, 'changeSummary', 'the change described in this notice')}.`,
        `The change takes effect on ${text(data, 'effectiveDate', 'the date in this notice')}.`,
        `This notice cannot be switched off in your account.`,
      ],
    })
  },
}

const dpaChange: SystemEmailTemplate = {
  key: 'system.batch3.dpa-change',
  sampleData: {
    businessName: 'Harbour Salon',
    changeSummary: 'the list of security measures in the Data Processing Addendum is narrowed',
    effectiveDate: '1 June 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Notice of a change to the Data Processing Addendum',
      title: 'StyleFlo',
      subtitle: 'Data Processing Addendum',
      paragraphs: [
        `Hello,`,
        `We are writing to ${business(data)} about a change that reduces the protection in the Data Processing Addendum. Clause 13 of the Addendum requires at least one month's notice before that kind of change.`,
        `What is changing: ${text(data, 'changeSummary', 'the change described in this notice')}.`,
        `The change takes effect on ${text(data, 'effectiveDate', 'the date in this notice')}.`,
        `This notice cannot be switched off in your account.`,
      ],
    })
  },
}

const privacyChange: SystemEmailTemplate = {
  key: 'system.batch3.privacy-change',
  sampleData: {
    businessName: 'Harbour Salon',
    changeSummary: 'StyleFlo will keep account contact details for a shorter period',
    effectiveDate: '1 June 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Notice of a change to the Privacy Policy',
      title: 'StyleFlo',
      subtitle: 'Privacy Policy',
      paragraphs: [
        `Hello,`,
        `We are writing to ${business(data)} before a significant change to the Privacy Policy takes effect. Privacy Policy Part H requires this notice before the change.`,
        `What is changing: ${text(data, 'changeSummary', 'the change described in this notice')}.`,
        `The change takes effect on ${text(data, 'effectiveDate', 'the date in this notice')}.`,
        `This notice cannot be switched off in your account.`,
      ],
    })
  },
}

const vatRegistration: SystemEmailTemplate = {
  key: 'system.batch3.vat-registration',
  sampleData: {
    businessName: 'Harbour Salon',
    vatNumber: 'GB000000000',
    effectiveDate: '1 April 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'StyleFlo VAT registration',
      title: 'StyleFlo',
      subtitle: 'VAT registration',
      paragraphs: [
        `Hello,`,
        `We are writing to ${business(data)} because StyleFlo has registered for VAT. The Terms (clause 4A.3) require this notice.`,
        `VAT registration number: ${text(data, 'vatNumber', 'the number in this notice')}.`,
        `The registration takes effect on ${text(data, 'effectiveDate', 'the date in this notice')}. From that date, VAT will be shown on your invoices.`,
        `This notice cannot be switched off in your account.`,
      ],
    })
  },
}

const contractTransfer: SystemEmailTemplate = {
  key: 'system.batch3.contract-transfer',
  sampleData: {
    businessName: 'Harbour Salon',
    transfereeName: 'Example Transferee Ltd',
    effectiveDate: '1 July 2027',
  },
  render(data) {
    const transferee = text(data, 'transfereeName', 'the organisation named in this notice')
    return renderBrandedSystemEmail({
      subject: 'Notice of a transfer of the contract',
      title: 'StyleFlo',
      subtitle: 'Transfer of the contract',
      paragraphs: [
        `Hello,`,
        `We are writing to ${business(data)} because StyleFlo will transfer the Terms. Clause 9.5 requires this notice.`,
        `The Terms transfer to ${transferee}.`,
        `The transfer takes effect on ${text(data, 'effectiveDate', 'the date in this notice')}. After that date, ${transferee} takes StyleFlo's place under the Terms.`,
        `This notice cannot be switched off in your account.`,
      ],
    })
  },
}

export const batch3Templates: readonly SystemEmailTemplate[] = [
  subProcessor,
  serviceChange,
  urgentChange,
  termsChange,
  dpaChange,
  privacyChange,
  vatRegistration,
  contractTransfer,
]

/** Subject, plain text and HTML for Stuart's review. Sample facts only. */
export const renderBatch3MassPreviewMarkdown = (): string => {
  const intro = [
    '# Batch 3 previews — legal notices #24–#31 (STYL-264)',
    '',
    'Rendered from the registered templates for Stuart to review. These are sample facts, not a live notice.',
    'Nothing is sent unless `SYSTEM_EMAILS_BATCH3_ENABLED` is exactly `true`. The flag is off by default.',
    'Package 5b adds the breach, data-rights and deletion previews to this file.',
    '',
  ]
  const blocks = batch3Templates.map((template) => {
    const notice = byKey.get(template.key)
    const content = template.render({ ...template.sampleData })
    return [
      `## #${notice?.number ?? ''} ${template.key}`,
      '',
      '### Subject',
      '',
      content.subject,
      '',
      '### Plain text',
      '',
      '```',
      content.text,
      '```',
      '',
      '### HTML',
      '',
      '```html',
      content.html,
      '```',
      '',
    ].join('\n')
  })
  return [...intro, ...blocks].join('\n')
}
