# Batch 2 system email previews (package 4b)

Rendered from the sample data in `src/lib/email/system/templates/batch-2.ts` for Stuart's template review (STYL-263).

Live sending is off unless `SYSTEM_EMAILS_BATCH2_ENABLED` is exactly `true`. These previews are not deliveries.

Sample business: Harbour Salon. Sample numbers use Ofcom drama ranges. No customer data.

These templates are ready. The auto top-up purchase path and the number-port events (STYL-167) are not in the app yet, so nothing in production calls the senders. Package 4a holds emails 2, 3, 22, 23 and the bolt-on confirmation. On merge, keep both preview sections.

| Template | Email | Trigger in this package |
| --- | --- | --- |
| system.batch2.auto-topup-receipt | 6. Auto top-up receipt | Template ready, trigger deferred. Auto top-up does not buy packs yet. |
| system.batch2.auto-topup-limit | 7. Auto top-up monthly limit | Template ready, trigger deferred. |
| system.batch2.auto-topup-payment | 8. Auto top-up payment failed or needs confirmation | Template ready, trigger deferred. |
| system.batch2.pack-price-change | 9. Pack price change (30 days) | Template ready, trigger deferred. |
| system.batch2.porting-received | 20. Port request received | Template ready, trigger deferred. Needs STYL-167. |
| system.batch2.porting-held | 20. Number held during a port | Template ready, trigger deferred. Needs STYL-167. |
| system.batch2.porting-completed | 20. Port completed | Template ready, trigger deferred. Needs STYL-167. |
| system.batch2.porting-failed | 20. Port did not complete | Template ready, trigger deferred. Needs STYL-167. |

## system.batch2.auto-topup-receipt

### Subject

StyleFlo auto top-up receipt

### Text

```
Hello,

This is a receipt for an automatic top-up on the StyleFlo account for Harbour Salon.

Date: 2 March 2027.

Pack: 30 voice minutes.

Amount: £14.99.

The payment was charged to the card saved on the account.

The pack lasts 3 months from the date it was bought. It is used only after the monthly allowance has run out. Packs are not refundable, except where the law requires otherwise.

This top-up also appears with the invoices in the billing section of the dashboard.

Reply to this email and it will reach StyleFlo support.
```

### HTML

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StyleFlo</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Auto top-up receipt</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>This is a receipt for an automatic top-up on the StyleFlo account for Harbour Salon.</p><p>Date: 2 March 2027.</p><p>Pack: 30 voice minutes.</p><p>Amount: £14.99.</p><p>The payment was charged to the card saved on the account.</p><p>The pack lasts 3 months from the date it was bought. It is used only after the monthly allowance has run out. Packs are not refundable, except where the law requires otherwise.</p><p>This top-up also appears with the invoices in the billing section of the dashboard.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    <div style="text-align: center; margin-top: 28px;">
      <a href="https://staging.styleflo.ai/dashboard?tab=billing" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Open billing</a>
    </div>
  </div>
</div>
```

## system.batch2.auto-topup-limit

### Subject

StyleFlo auto top-up has reached its monthly limit

### Text

```
Hello,

Auto top-up on the StyleFlo account for Harbour Salon has reached its monthly limit.

The limit that was reached: the monthly limit set on the account.

Auto top-up will not buy another pack until the next billing month, which starts on 2 April 2027.

Reply to this email and it will reach StyleFlo support.
```

### HTML

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StyleFlo</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Auto top-up limit</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>Auto top-up on the StyleFlo account for Harbour Salon has reached its monthly limit.</p><p>The limit that was reached: the monthly limit set on the account.</p><p>Auto top-up will not buy another pack until the next billing month, which starts on 2 April 2027.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    <div style="text-align: center; margin-top: 28px;">
      <a href="https://staging.styleflo.ai/dashboard?tab=billing" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Open billing</a>
    </div>
  </div>
</div>
```

## system.batch2.auto-topup-payment

### Subject

StyleFlo auto top-up payment needs confirmation

### Text

```
Hello,

Your bank has asked you to confirm an automatic top-up payment. This is for the StyleFlo account for Harbour Salon.

Pack: 30 voice minutes.

Amount: £14.99.

No pack has been added. A pack is added only when the payment goes through.

A failed top-up does not pause the account.

You can update the card in the billing section of the dashboard.

Reply to this email and it will reach StyleFlo support.
```

### HTML

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StyleFlo</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Auto top-up payment</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>Your bank has asked you to confirm an automatic top-up payment. This is for the StyleFlo account for Harbour Salon.</p><p>Pack: 30 voice minutes.</p><p>Amount: £14.99.</p><p>No pack has been added. A pack is added only when the payment goes through.</p><p>A failed top-up does not pause the account.</p><p>You can update the card in the billing section of the dashboard.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    <div style="text-align: center; margin-top: 28px;">
      <a href="https://staging.styleflo.ai/dashboard?tab=billing" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Open billing</a>
    </div>
  </div>
</div>
```

## system.batch2.pack-price-change

### Subject

StyleFlo pack price change

### Text

```
Hello,

The price of 30 voice minutes on the StyleFlo account for Harbour Salon is changing. The price changes from £14.99 to £15.99.

Auto top-up will not buy this pack at the new price before 15 April 2027.

This notice is at least 30 days before auto top-up first buys a pack at the new price. You can turn auto top-up off, or change the auto top-up settings, in the dashboard before then.

The price of a pack that has already been bought does not change.

Reply to this email and it will reach StyleFlo support.
```

### HTML

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StyleFlo</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Pack price change</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>The price of 30 voice minutes on the StyleFlo account for Harbour Salon is changing. The price changes from £14.99 to £15.99.</p><p>Auto top-up will not buy this pack at the new price before 15 April 2027.</p><p>This notice is at least 30 days before auto top-up first buys a pack at the new price. You can turn auto top-up off, or change the auto top-up settings, in the dashboard before then.</p><p>The price of a pack that has already been bought does not change.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    <div style="text-align: center; margin-top: 28px;">
      <a href="https://staging.styleflo.ai/dashboard?tab=billing" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Open billing</a>
    </div>
  </div>
</div>
```

## system.batch2.porting-received

### Subject

Your StyleFlo number port request has been received

### Text

```
Hello,

We have received a request to move (port) the StyleFlo UK landline number 01632 960123 for Harbour Salon to another provider.

We will release the number to that provider.

Reply to this email and it will reach StyleFlo support.
```

### HTML

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StyleFlo</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Number port</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>We have received a request to move (port) the StyleFlo UK landline number 01632 960123 for Harbour Salon to another provider.</p><p>We will release the number to that provider.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## system.batch2.porting-held

### Subject

Your StyleFlo number is held while a port is in progress

### Text

```
Hello,

A port of the StyleFlo UK mobile number 07700 900123 for Harbour Salon is in progress.

The number was due to be released. We will keep it until the port completes.

Reply to this email and it will reach StyleFlo support.
```

### HTML

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StyleFlo</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Number port</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>A port of the StyleFlo UK mobile number 07700 900123 for Harbour Salon is in progress.</p><p>The number was due to be released. We will keep it until the port completes.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## system.batch2.porting-completed

### Subject

Your StyleFlo number port has completed

### Text

```
Hello,

The port of the StyleFlo UK landline number 01632 960123 for Harbour Salon has completed.

We have released the number to the new provider. It is no longer a StyleFlo number.

Reply to this email and it will reach StyleFlo support.
```

### HTML

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StyleFlo</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Number port</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>The port of the StyleFlo UK landline number 01632 960123 for Harbour Salon has completed.</p><p>We have released the number to the new provider. It is no longer a StyleFlo number.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```

## system.batch2.porting-failed

### Subject

Your StyleFlo number port did not complete

### Text

```
Hello,

The port of the StyleFlo UK mobile number 07700 900123 for Harbour Salon did not complete.

The number is still a StyleFlo number.

Reply to this email and it will reach StyleFlo support.
```

### HTML

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">StyleFlo</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Number port</p>
  </div>
  <div style="padding: 24px;">
    <p>Hello,</p><p>The port of the StyleFlo UK mobile number 07700 900123 for Harbour Salon did not complete.</p><p>The number is still a StyleFlo number.</p><p>Reply to this email and it will reach StyleFlo support.</p>
    
  </div>
</div>
```
