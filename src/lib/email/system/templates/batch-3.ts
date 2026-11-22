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

const batch3MassTemplates: readonly SystemEmailTemplate[] = [
  subProcessor,
  serviceChange,
  urgentChange,
  termsChange,
  dpaChange,
  privacyChange,
  vatRegistration,
  contractTransfer,
]

const off = 'This notice cannot be switched off in your account.'

const breachFacts = (data: Record<string, string>): string[] => [
  `What happened: ${text(data, 'nature', 'the breach described in this notice')}.`,
  `People affected: ${text(data, 'peopleAffected', 'the people described in this notice')}.`,
  `Records affected: ${text(data, 'recordsAffected', 'the records described in this notice')}.`,
  `Likely consequences: ${text(data, 'consequences', 'the consequences described in this notice')}.`,
  `Measures taken or proposed: ${text(data, 'measures', 'the measures described in this notice')}.`,
  `Contact: ${text(data, 'contactName', 'StyleFlo support')}.`,
  `We became aware on ${text(data, 'awarenessAt', 'the date in this notice')}.`,
]

const breachSalon: SystemEmailTemplate = {
  key: 'system.batch3.breach-salon',
  sampleData: {
    businessName: 'Harbour Salon',
    nature: 'a copy of booking names was sent to the wrong internal mailbox and then deleted',
    peopleAffected: 'customers with a booking in March 2027',
    recordsAffected: 'booking name and phone number',
    consequences: 'those contact details may have been seen by a member of staff who does not work on that account',
    measures: 'the mailbox copy was deleted and access to that mailbox was removed',
    contactName: 'StyleFlo support',
    awarenessAt: '1 March 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Personal data breach notice',
      title: 'StyleFlo',
      subtitle: 'Personal data breach',
      paragraphs: [
        'Hello,',
        `We are writing to ${business(data)} about a personal data breach affecting personal data we process for you. The Terms (clause 6A.7), the Data Processing Addendum (clause 9.1) and Privacy Policy Part F describe this notice.`,
        ...breachFacts(data),
        off,
      ],
    })
  },
}

const breachIndividual: SystemEmailTemplate = {
  key: 'system.batch3.breach-individual',
  sampleData: {
    recipientName: 'Alex',
    nature: 'account contact details were copied to the wrong internal mailbox and then deleted',
    peopleAffected: 'the account user named in this notice',
    recordsAffected: 'account name and email address',
    consequences: 'those details may have been seen by someone who does not need them for your account',
    measures: 'the copy was deleted and access to that mailbox was removed',
    contactName: 'StyleFlo support',
    awarenessAt: '1 March 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Personal data breach notice',
      title: 'StyleFlo',
      subtitle: 'Personal data breach',
      paragraphs: [
        `Hello ${text(data, 'recipientName', 'there')},`,
        'We are writing to you about a personal data breach affecting account data StyleFlo controls. Privacy Policy Part F describes this notice, where the law requires us to contact you.',
        ...breachFacts(data),
      ],
    })
  },
}

const metaReceived: SystemEmailTemplate = {
  key: 'system.batch3.meta-deletion-received',
  sampleData: {
    confirmationCode: 'del_example',
    statusUrl: 'https://app.styleflo.ai/api/data-deletion?code=del_example',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'We have received your Meta data-deletion request',
      title: 'StyleFlo',
      subtitle: 'Data deletion',
      paragraphs: [
        'Hello,',
        'We have received a request to delete messaging data linked to your Meta account. Privacy Policy Part E describes this confirmation.',
        `Reference: ${text(data, 'confirmationCode', 'the reference in this notice')}.`,
        `Status: ${text(data, 'statusUrl', 'the status page in this notice')}.`,
      ],
    })
  },
}

const metaDeleted: SystemEmailTemplate = {
  key: 'system.batch3.meta-deletion-deleted',
  sampleData: {
    confirmationCode: 'del_example',
    statusUrl: 'https://app.styleflo.ai/api/data-deletion?code=del_example',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Your Meta messaging data has been deleted',
      title: 'StyleFlo',
      subtitle: 'Data deletion',
      paragraphs: [
        'Hello,',
        'We have deleted the messaging data linked to your Meta account for the reference below. Privacy Policy Part E describes this confirmation.',
        `Reference: ${text(data, 'confirmationCode', 'the reference in this notice')}.`,
        `Status: ${text(data, 'statusUrl', 'the status page in this notice')}.`,
      ],
    })
  },
}

const dsarPassedOn: SystemEmailTemplate = {
  key: 'system.batch3.dsar-passed-on',
  sampleData: {
    businessName: 'Harbour Salon',
    requestSummary: 'a person asked for a copy of the messages they sent to the salon assistant',
    receivedAt: '2 March 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'A data-subject request has been passed to you',
      title: 'StyleFlo',
      subtitle: 'Data-subject request',
      paragraphs: [
        'Hello,',
        `Someone contacted StyleFlo directly with a data-subject request that relates to ${business(data)}. The Data Processing Addendum (clause 8.2) and Privacy Policy section B6 say we pass that request on to you.`,
        `Request: ${text(data, 'requestSummary', 'the request described in this notice')}.`,
        `Received: ${text(data, 'receivedAt', 'the date in this notice')}.`,
        'StyleFlo has not decided the request. It is for your business to handle.',
        off,
      ],
    })
  },
}

const legalRequirement: SystemEmailTemplate = {
  key: 'system.batch3.legal-requirement',
  sampleData: {
    businessName: 'Harbour Salon',
    requirementSummary: 'a UK authority has required a copy of specified booking records',
    effectiveDate: '10 March 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Notice of processing required by UK law',
      title: 'StyleFlo',
      subtitle: 'Legal requirement',
      paragraphs: [
        'Hello,',
        `Before we process personal data because UK law requires it, the Data Processing Addendum (clause 3.1) says we tell ${business(data)}, unless the law forbids us to.`,
        `What the law requires: ${text(data, 'requirementSummary', 'the requirement described in this notice')}.`,
        `We will do this on ${text(data, 'effectiveDate', 'the date in this notice')}.`,
        off,
      ],
    })
  },
}

const unlawfulInstruction: SystemEmailTemplate = {
  key: 'system.batch3.unlawful-instruction',
  sampleData: {
    businessName: 'Harbour Salon',
    instructionSummary: 'keep all customer messages forever',
    reason: 'keeping the messages with no end date would break the retention rules in the Data Processing Addendum',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'We cannot follow that instruction',
      title: 'StyleFlo',
      subtitle: 'Unlawful instruction',
      paragraphs: [
        'Hello,',
        `We are writing straight away because an instruction from ${business(data)} would break data protection law. The Data Processing Addendum (clause 3.4) requires this notice.`,
        `Instruction: ${text(data, 'instructionSummary', 'the instruction described in this notice')}.`,
        `Why we will not follow it: ${text(data, 'reason', 'the reason described in this notice')}.`,
        off,
      ],
    })
  },
}

const deletionConfirmation: SystemEmailTemplate = {
  key: 'system.batch3.deletion-confirmation',
  sampleData: {
    businessName: 'Harbour Salon',
    deletionSummary: 'the account was closed and the salon data held by StyleFlo was deleted',
    completedAt: '4 March 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Written confirmation of deletion',
      title: 'StyleFlo',
      subtitle: 'Deletion confirmation',
      paragraphs: [
        'Hello,',
        `You asked ${business(data)} for written confirmation after deletion or closure. The Data Processing Addendum (clause 10.3) provides for this confirmation.`,
        `What was deleted or closed: ${text(data, 'deletionSummary', 'the deletion described in this notice')}.`,
        `When: ${text(data, 'completedAt', 'the date in this notice')}.`,
        off,
      ],
    })
  },
}

const humanReply: SystemEmailTemplate = {
  key: 'system.batch3.data-rights-reply',
  sampleData: {
    businessName: 'Harbour Salon',
    requestSummary: 'the account user asked for a copy of their account data',
    repliedAt: '5 March 2027',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Record of a reply to a data-rights request',
      title: 'StyleFlo',
      subtitle: 'Data-rights request',
      paragraphs: [
        'Hello,',
        `This is a record that a person at StyleFlo replied to a data-rights request for ${business(data)}. Privacy Policy section A7 says that reply is due within one month. The reply itself is sent by that person. The app records it and does not send the reply.`,
        `Request: ${text(data, 'requestSummary', 'the request described in this record')}.`,
        `Reply recorded on ${text(data, 'repliedAt', 'the date in this record')}.`,
      ],
    })
  },
}

const gdprConfirmation: SystemEmailTemplate = {
  key: 'system.batch3.gdpr-confirmation',
  sampleData: {
    businessName: 'Harbour Salon',
    requestSummary: 'a customer asked for their messages to be deleted',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'We have received your data request',
      title: 'StyleFlo',
      subtitle: 'Data request',
      paragraphs: [
        'Hello,',
        `We have received a data request from ${business(data)}. This email confirms the request. It is not the outcome.`,
        `Request: ${text(data, 'requestSummary', 'the request described in this notice')}.`,
        off,
      ],
    })
  },
}

const gdprOutcome: SystemEmailTemplate = {
  key: 'system.batch3.gdpr-outcome',
  sampleData: {
    businessName: 'Harbour Salon',
    requestSummary: 'a customer asked for their messages to be deleted',
    outcomeSummary: 'the matching appointments, conversations and messages were deleted',
  },
  render(data) {
    return renderBrandedSystemEmail({
      subject: 'Outcome of your data request',
      title: 'StyleFlo',
      subtitle: 'Data request',
      paragraphs: [
        'Hello,',
        `This is the outcome of the data request from ${business(data)}.`,
        `Request: ${text(data, 'requestSummary', 'the request described in this notice')}.`,
        `Outcome: ${text(data, 'outcomeSummary', 'the outcome described in this notice')}.`,
        off,
      ],
    })
  },
}

/** Breach, data-rights and deletion templates. */
const batch3DataTemplates: readonly SystemEmailTemplate[] = [
  breachSalon,
  breachIndividual,
  metaReceived,
  metaDeleted,
  dsarPassedOn,
  legalRequirement,
  unlawfulInstruction,
  deletionConfirmation,
  humanReply,
  gdprConfirmation,
  gdprOutcome,
]

export const batch3Templates: readonly SystemEmailTemplate[] = [
  ...batch3MassTemplates,
  ...batch3DataTemplates,
]


/** Subject, plain text and HTML for Stuart's review. Sample facts only. */
export const renderBatch3MassPreviewMarkdown = (): string => {
  const intro = [
    '# Batch 3 previews — legal notices #24–#31 (STYL-264)',
    '',
    'Rendered from the registered templates for Stuart to review. These are sample facts, not a live notice.',
    'Nothing is sent unless `SYSTEM_EMAILS_BATCH3_ENABLED` is exactly `true`. The flag is off by default.',
    'The breach, data-rights and deletion previews follow in this file.',
    '',
  ]
  const blocks = batch3MassTemplates.map((template) => {
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


const numbers: Record<string, number> = {
  'system.batch3.breach-salon': 36,
  'system.batch3.meta-deletion-received': 39,
  'system.batch3.meta-deletion-deleted': 39,
  'system.batch3.dsar-passed-on': 40,
  'system.batch3.legal-requirement': 49,
  'system.batch3.unlawful-instruction': 50,
  'system.batch3.deletion-confirmation': 51,
  'system.batch3.data-rights-reply': 52,
  'system.batch3.breach-individual': 53,
  'system.batch3.gdpr-confirmation': 55,
  'system.batch3.gdpr-outcome': 55,
}

/** Subject, plain text and HTML for Stuart's review. Sample facts only. */
export const renderBatch3DataPreviewMarkdown = (): string => {
  const intro = [
    '# Batch 3 previews — breach, data rights and deletion (STYL-264)',
    '',
    'Rendered from the registered templates for Stuart to review. These are sample facts, not a live notice.',
    'Nothing is sent unless `SYSTEM_EMAILS_BATCH3_ENABLED` is exactly `true`. The flag is off by default.',
    'Notices #24–#31 are above in this file. UK GDPR timing for #36 and #53 is not stated in these emails. Solicitor confirmation is still pending.',
    'Email #52 is a record of a human reply. The app does not send that reply.',
    '',
  ]
  const blocks = batch3DataTemplates.map((template) => {
    const content = template.render({ ...template.sampleData })
    return [
      `## #${numbers[template.key] ?? ''} ${template.key}`,
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
