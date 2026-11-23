# STYL-265 batch 4 previews (part A)

Rendered for review. No live send. British English. `#41` and `#45` keep their existing bodies. The business can turn either off. Both default on. Auth emails `#42`–`#44` are Supabase Auth template files. Hosted SMTP is not configured in this repository.

## #41 Enquiry details

Subject: `[New Lead] Appointment & Booking Enquiry captured by Harbour Bot`

From: the assistant name, unchanged.

Plain text:

```
==================================================
NEW LEAD CAPTURED BY AI CHATBOT
==================================================
Business: Harbour Salon
Chatbot: Harbour Bot
Channel: Web Chat
Date & Time: (sent at the time of the enquiry, Europe/London)
Customer Name: Alex

--------------------------------------------------
CONSOLIDATED CONTACT DETAILS:
- Email Address: alex@example.test
- Mobile / Telephone: Not provided yet
--------------------------------------------------
CUSTOMER INTENT:
- Category: Appointment & Booking Enquiry
- Primary Enquiry: "Please book a trim next Friday."
--------------------------------------------------
--- CHAT TRANSCRIPT ---
Customer: Please book a trim next Friday.
--------------------------------------------------
Log into your StyleFlo Dashboard to view and manage this conversation.
==================================================
```

HTML uses the existing branded lead layout (`New Lead Captured`, contact table, intent, transcript, dashboard link). Turning the control off sends nothing and does not mark the conversation as already emailed.

## #45 Booking confirmation

From: `"Harbour Salon" via StyleFlo <no-reply@MAILGUN_DOMAIN>`

Subject: `Booking Confirmed: Cut with Sam`

Plain text:

```
Hi Alex,

Your appointment for Cut with Sam is confirmed for 22 November 2026, 10:00.

To cancel or reschedule, please contact the small business directly.

Thank you for booking with Harbour Salon.
```

HTML:

```html
<p>Hi Alex,</p>
<p>Your appointment for <strong>Cut</strong> with <strong>Sam</strong> is confirmed for <strong>22 November 2026, 10:00</strong>.</p>
<p>To cancel or reschedule, please contact the small business directly.</p>
<p>Thank you for booking with Harbour Salon.</p>
```

When a manage link exists, the plain text and HTML include that link instead of the contact line. Turning the control off sends nothing.

## #42 Sign-up confirmation

Subject: `Confirm your StyleFlo email address`

Plain text:

```
Hello,

Please confirm your email address for your StyleFlo account.

Confirm email address: {{ .ConfirmationURL }}

If you did not create a StyleFlo account, you can ignore this email.

Reply to this email and it will reach StyleFlo support.
```

HTML: `supabase/templates/confirmation.html`

## #43 Magic sign-in link

Subject: `Your StyleFlo sign-in link`

Plain text:

```
Hello,

Use the link below to sign in to StyleFlo.

Sign in to StyleFlo: {{ .ConfirmationURL }}

If you did not ask for a sign-in link, you can ignore this email.

Reply to this email and it will reach StyleFlo support.
```

HTML: `supabase/templates/magic_link.html`

## #44 Password reset

Subject: `Reset your StyleFlo password`

Plain text:

```
Hello,

Use the link below to choose a new password.

Reset password: {{ .ConfirmationURL }}

If you did not ask to reset your password, you can ignore this email.

Reply to this email and it will reach StyleFlo support.
```

HTML: `supabase/templates/recovery.html`

Admin notices `#32`–`#35`, `#37`, `#38`, `#46`–`#48` and `#54` are in the following part of this batch. They stay off until `SYSTEM_EMAILS_BATCH4_ENABLED=true`.

# STYL-265 batch 4 previews (part B)

Rendered from the registered templates with their sample data. No live send. `SYSTEM_EMAILS_BATCH4_ENABLED` defaults off. British English. Ending the Terms does not start a refund.

## enforcement.breach.notice

Subject: `Breach notice for Harbour Salon: 14 days to put it right`

Plain text:

```
Hello,

StyleFlo believes Harbour Salon is in breach of the Terms.

What is wrong: The account was used to send messages the business is not allowed to send.

You have 14 days from the date of this email to put it right.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Breach notice</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>StyleFlo believes Harbour Salon is in breach of the Terms.</p><p>What is wrong: The account was used to send messages the business is not allowed to send.</p><p>You have 14 days from the date of this email to put it right.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## enforcement.suspension.notice

Subject: `StyleFlo service suspended for Harbour Salon`

Plain text:

```
Hello,

The StyleFlo service for Harbour Salon is suspended now.

This suspension is for serious or illegal misuse.

What happened: The service was used for serious or illegal misuse.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Service suspended</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>The StyleFlo service for Harbour Salon is suspended now.</p><p>This suspension is for serious or illegal misuse.</p><p>What happened: The service was used for serious or illegal misuse.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## enforcement.termination.notice

Subject: `The Terms have ended for Harbour Salon`

Plain text:

```
Hello,

StyleFlo is ending the Terms for Harbour Salon.

The breach was not put right within 14 days.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Terms ended</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>StyleFlo is ending the Terms for Harbour Salon.</p><p>The breach was not put right within 14 days.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## enforcement.terms-end.notice

Subject: `StyleFlo is ending the Terms for Harbour Salon`

Plain text:

```
Hello,

StyleFlo is ending the Terms for Harbour Salon on 31 December 2026.

This notice is given at least one month before that date.

Any refund of fees already paid for the time after that date is arranged by a separate admin action. This email does not start a refund.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Notice that the Terms will end</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>StyleFlo is ending the Terms for Harbour Salon on 31 December 2026.</p><p>This notice is given at least one month before that date.</p><p>Any refund of fees already paid for the time after that date is arranged by a separate admin action. This email does not start a refund.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## complaint.forward

Subject: `Complaint forwarded for Harbour Salon`

Plain text:

```
A chat message was labelled as a complaint.

Business: Harbour Salon

Complainant: Alex

Transcript: Customer: I want to make a complaint about a missed appointment.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Complaint forwarded</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>A chat message was labelled as a complaint.</p><p>Business: Harbour Salon</p><p>Complainant: Alex</p><p>Transcript: Customer: I want to make a complaint about a missed appointment.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## complaint.acknowledgement

Subject: `We have received your complaint`

Plain text:

```
Hello Alex,

We have received your complaint. This email is the acknowledgement, and it is sent within 2 working days.

A person at StyleFlo decides the outcome. A full reply is due within 10 working days.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Complaint received</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello Alex,</p><p>We have received your complaint. This email is the acknowledgement, and it is sent within 2 working days.</p><p>A person at StyleFlo decides the outcome. A full reply is due within 10 working days.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## fair-use.warning

Subject: `Fair-use warning for Harbour Salon`

Plain text:

```
Hello,

Use of StyleFlo by Harbour Salon is clearly outside normal use.

What we have seen: Message volume is clearly outside normal use.

We are contacting you first.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Fair use</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>Use of StyleFlo by Harbour Salon is clearly outside normal use.</p><p>What we have seen: Message volume is clearly outside normal use.</p><p>We are contacting you first.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## channel.launch.notice

Subject: `StyleFlo will launch a further messaging channel`

Plain text:

```
Hello,

StyleFlo will launch a further messaging channel on 1 January 2027.

This notice is sent before that channel launches.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">New channel</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>StyleFlo will launch a further messaging channel on 1 January 2027.</p><p>This notice is sent before that channel launches.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## maintenance.planned.notice

Subject: `Planned StyleFlo maintenance`

Plain text:

```
Hello,

StyleFlo has planned maintenance from 1 December 2026, 01:00 UK time to 1 December 2026, 03:00 UK time.

What is affected: The dashboard may be unavailable.

This notice is sent before that maintenance.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Planned maintenance</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>StyleFlo has planned maintenance from 1 December 2026, 01:00 UK time to 1 December 2026, 03:00 UK time.</p><p>What is affected: The dashboard may be unavailable.</p><p>This notice is sent before that maintenance.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## support.human-follow-up

Subject: `A person from StyleFlo will follow up`

Plain text:

```
Hello,

The customer asked to speak to a person.

A person from StyleFlo will follow up with Harbour Salon.

Reply to this email and it will reach StyleFlo support.
```

HTML:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Human follow-up</h2>
    
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>The customer asked to speak to a person.</p><p>A person from StyleFlo will follow up with Harbour Salon.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```
