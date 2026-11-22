import { renderBrandedSystemEmail } from '../layout'
import type { SystemEmailTemplate } from '../types'

const text = (data: Record<string, string>, key: string, fallback: string): string => {
  const raw = data[key]
  if (typeof raw !== 'string') return fallback
  const cleaned = raw.replace(/[\r\n\u0000]+/g, ' ').trim()
  return cleaned || fallback
}

const business = (data: Record<string, string>): string => text(data, 'businessName', 'your business')

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

/** Breach, data-rights and deletion templates. Mass notices #24–#31 are package 5a. */
export const batch3Templates: readonly SystemEmailTemplate[] = [
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
    'Package 5a adds notices #24–#31 to this file. UK GDPR timing for #36 and #53 is not stated in these emails. Solicitor confirmation is still pending.',
    'Email #52 is a record of a human reply. The app does not send that reply.',
    '',
  ]
  const blocks = batch3Templates.map((template) => {
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
