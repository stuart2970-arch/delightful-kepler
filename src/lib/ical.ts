// RFC 5545 iCalendar (.ics) Generator Utility for StyleFlo Appointments

export interface ICSEventParams {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date | string; // ISO String or Date
  end: Date | string;
  organizerName?: string;
  organizerEmail?: string;
  customerName?: string;
  customerPhone?: string;
}

function formatDateToICS(dateInput: Date | string): string {
  const date = new Date(dateInput);
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

export function generateICSContent(params: ICSEventParams): string {
  const {
    uid,
    summary,
    description = '',
    location = '',
    start,
    end,
    organizerName = 'StyleFlo Business',
    organizerEmail = 'appointments@styleflo.ai',
    customerName = '',
    customerPhone = ''
  } = params;

  const dtStart = formatDateToICS(start);
  const dtEnd = formatDateToICS(end);
  const dtStamp = formatDateToICS(new Date());

  const fullDescription = [
    description,
    customerName ? `Customer: ${customerName}` : '',
    customerPhone ? `Mobile Phone: ${customerPhone}` : '',
    'Booked via StyleFlo AI Concierge'
  ].filter(Boolean).join('\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StyleFlo AI//NONGNS',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid || 'evt-' + Date.now()}@styleflo.ai`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary.replace(/\n/g, ' ')}`,
    `DESCRIPTION:${fullDescription}`,
    location ? `LOCATION:${location.replace(/\n/g, ' ')}` : '',
    `ORGANIZER;CN=${organizerName}:mailto:${organizerEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);

  return lines.join('\r\n');
}
