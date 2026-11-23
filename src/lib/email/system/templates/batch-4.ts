import { renderBrandedSystemEmail } from '../layout'
import type { SystemEmailTemplate } from '../types'

function value(data: Record<string, string>, key: string, fallback: string): string {
  const raw = data[key]
  return raw && raw.trim() ? raw.trim() : fallback
}

function branded(
  key: string,
  sampleData: Record<string, string>,
  build: (data: Record<string, string>) => { subject: string; title: string; paragraphs: string[] },
): SystemEmailTemplate {
  return {
    key,
    sampleData,
    render(data) {
      const content = build(data)
      return renderBrandedSystemEmail({
        subject: content.subject,
        title: content.title,
        paragraphs: content.paragraphs,
      })
    },
  }
}

/** STYL-265 admin and service notices. Registered by the shared registry import. */
export const batch4Templates: readonly SystemEmailTemplate[] = [
  branded(
    'enforcement.breach.notice',
    { businessName: 'Harbour Salon', whatIsWrong: 'The account was used to send messages the business is not allowed to send.' },
    (data) => {
      const business = value(data, 'businessName', 'your business')
      return {
        subject: `Breach notice for ${business}: 14 days to put it right`,
        title: 'Breach notice',
        paragraphs: [
          `Hello,`,
          `StyleFlo believes ${business} is in breach of the Terms.`,
          `What is wrong: ${value(data, 'whatIsWrong', 'The details were not included in this notice.')}`,
          `You have 14 days from the date of this email to put it right.`,
        ],
      }
    },
  ),
  branded(
    'enforcement.suspension.notice',
    { businessName: 'Harbour Salon', summary: 'The service was used for serious or illegal misuse.' },
    (data) => {
      const business = value(data, 'businessName', 'your business')
      return {
        subject: `StyleFlo service suspended for ${business}`,
        title: 'Service suspended',
        paragraphs: [
          `Hello,`,
          `The StyleFlo service for ${business} is suspended now.`,
          `This suspension is for serious or illegal misuse.`,
          `What happened: ${value(data, 'summary', 'The details were not included in this notice.')}`,
        ],
      }
    },
  ),
  branded(
    'enforcement.termination.notice',
    { businessName: 'Harbour Salon', reason: 'The breach was not put right within 14 days.' },
    (data) => {
      const business = value(data, 'businessName', 'your business')
      return {
        subject: `The Terms have ended for ${business}`,
        title: 'Terms ended',
        paragraphs: [
          `Hello,`,
          `StyleFlo is ending the Terms for ${business}.`,
          value(data, 'reason', 'The breach was not put right within 14 days, or misuse has been confirmed.'),
        ],
      }
    },
  ),
  branded(
    'enforcement.terms-end.notice',
    { businessName: 'Harbour Salon', endDate: '31 December 2026' },
    (data) => {
      const business = value(data, 'businessName', 'your business')
      const endDate = value(data, 'endDate', 'the date in this notice')
      return {
        subject: `StyleFlo is ending the Terms for ${business}`,
        title: 'Notice that the Terms will end',
        paragraphs: [
          `Hello,`,
          `StyleFlo is ending the Terms for ${business} on ${endDate}.`,
          `This notice is given at least one month before that date.`,
          `Any refund of fees already paid for the time after that date is arranged by a separate admin action. This email does not start a refund.`,
        ],
      }
    },
  ),
  branded(
    'complaint.forward',
    {
      businessName: 'Harbour Salon',
      complainant: 'Alex',
      transcript: 'Customer: I want to make a complaint about a missed appointment.',
    },
    (data) => ({
      subject: `Complaint forwarded for ${value(data, 'businessName', 'a StyleFlo business')}`,
      title: 'Complaint forwarded',
      paragraphs: [
        `A chat message was labelled as a complaint.`,
        `Business: ${value(data, 'businessName', 'Not stated')}`,
        `Complainant: ${value(data, 'complainant', 'Not stated')}`,
        `Transcript: ${value(data, 'transcript', 'No transcript was attached.')}`,
      ],
    }),
  ),
  branded(
    'complaint.acknowledgement',
    { complainant: 'Alex' },
    (data) => ({
      subject: 'We have received your complaint',
      title: 'Complaint received',
      paragraphs: [
        `Hello ${value(data, 'complainant', 'there')},`,
        `We have received your complaint. This email is the acknowledgement, and it is sent within 2 working days.`,
        `A person at StyleFlo decides the outcome. A full reply is due within 10 working days.`,
      ],
    }),
  ),
  branded(
    'fair-use.warning',
    { businessName: 'Harbour Salon', summary: 'Message volume is clearly outside normal use.' },
    (data) => {
      const business = value(data, 'businessName', 'your business')
      return {
        subject: `Fair-use warning for ${business}`,
        title: 'Fair use',
        paragraphs: [
          `Hello,`,
          `Use of StyleFlo by ${business} is clearly outside normal use.`,
          `What we have seen: ${value(data, 'summary', 'The details were not included in this notice.')}`,
          `We are contacting you first.`,
        ],
      }
    },
  ),
  branded(
    'channel.launch.notice',
    { channelName: 'a further messaging channel', launchDate: '1 January 2027' },
    (data) => {
      const channel = value(data, 'channelName', 'a new channel')
      return {
        subject: `StyleFlo will launch ${channel}`,
        title: 'New channel',
        paragraphs: [
          `Hello,`,
          `StyleFlo will launch ${channel} on ${value(data, 'launchDate', 'the date we have given')}.`,
          `This notice is sent before that channel launches.`,
        ],
      }
    },
  ),
  branded(
    'maintenance.planned.notice',
    { windowStart: '1 December 2026, 01:00 UK time', windowEnd: '1 December 2026, 03:00 UK time', whatIsAffected: 'The dashboard may be unavailable.' },
    (data) => ({
      subject: 'Planned StyleFlo maintenance',
      title: 'Planned maintenance',
      paragraphs: [
        `Hello,`,
        `StyleFlo has planned maintenance from ${value(data, 'windowStart', 'the start time in this notice')} to ${value(data, 'windowEnd', 'the end time in this notice')}.`,
        `What is affected: ${value(data, 'whatIsAffected', 'Some of the service may be unavailable.')}`,
        `This notice is sent before that maintenance.`,
      ],
    }),
  ),
  branded(
    'support.human-follow-up',
    { businessName: 'Harbour Salon', requestSummary: 'The customer asked to speak to a person.' },
    (data) => ({
      subject: 'A person from StyleFlo will follow up',
      title: 'Human follow-up',
      paragraphs: [
        `Hello,`,
        `${value(data, 'requestSummary', 'You asked to speak to a person.')}`,
        `A person from StyleFlo will follow up with ${value(data, 'businessName', 'you')}.`,
      ],
    }),
  ),
]
