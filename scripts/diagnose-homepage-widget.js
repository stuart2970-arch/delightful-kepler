const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('turnstile') || u.includes('chat') || u.includes('public-init')) {
      let body = '';
      try { body = await res.text(); } catch {}
      console.log('RES:', res.status(), u, body.slice(0, 300));
    }
  });

  console.log('Navigating to https://styleflo.ai/...');
  await page.goto('https://styleflo.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Click bubble
  console.log('Clicking bubble inside shadow root...');
  const clicked = await page.evaluate(() => {
    const host = document.getElementById('styleflo-chat-widget');
    if (!host || !host.shadowRoot) return false;
    // Find bubble button
    const btns = Array.from(host.shadowRoot.querySelectorAll('button'));
    const bubble = btns.find(b => b.querySelector('svg'));
    if (bubble) {
      bubble.click();
      return true;
    }
    return false;
  });
  console.log('Clicked bubble:', clicked);
  await page.waitForTimeout(2000);

  // Now inspect shadow root content (disclaimer or chat window)
  const windowState = await page.evaluate(() => {
    const host = document.getElementById('styleflo-chat-widget');
    if (!host || !host.shadowRoot) return null;
    const sr = host.shadowRoot;
    const inputs = Array.from(sr.querySelectorAll('input')).map(i => ({ type: i.type, placeholder: i.placeholder, id: i.id }));
    const btns = Array.from(sr.querySelectorAll('button')).map(b => b.textContent?.trim());
    return { inputs, btns, innerText: sr.host.innerText?.slice(0, 300) };
  });
  console.log('Window state:', JSON.stringify(windowState, null, 2));

  // Fill name, agree to terms, click start chat if present
  const started = await page.evaluate(() => {
    const host = document.getElementById('styleflo-chat-widget');
    if (!host || !host.shadowRoot) return false;
    const sr = host.shadowRoot;
    const textInput = sr.querySelector('input[type="text"]');
    if (textInput) {
      textInput.value = 'Stuart Test';
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const cb = sr.querySelector('input[type="checkbox"]');
    if (cb) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const startBtn = Array.from(sr.querySelectorAll('button')).find(b => b.textContent?.includes('Start Chat') || b.textContent?.includes('Continue'));
    if (startBtn) {
      startBtn.click();
      return true;
    }
    return false;
  });
  console.log('Started chat gate:', started);
  await page.waitForTimeout(2000);

  // Now send a message!
  console.log('Typing message and submitting form...');
  const sent = await page.evaluate(async () => {
    const host = document.getElementById('styleflo-chat-widget');
    if (!host || !host.shadowRoot) return false;
    const sr = host.shadowRoot;
    const input = sr.querySelector('#styleflo-input');
    if (!input) return 'no-input';
    input.value = 'Hello! Is text chat working?';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const form = sr.querySelector('#styleflo-chat-form');
    if (form) {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
      return 'submitted-form';
    }
    return 'no-form';
  });
  console.log('Sent result:', sent);

  // Wait 15 seconds to observe network and chat messages
  console.log('Waiting 15 seconds...');
  await page.waitForTimeout(15000);

  // Check turnstile and messages
  const finalState = await page.evaluate(() => {
    const host = document.getElementById('styleflo-chat-widget');
    const sr = host?.shadowRoot;
    const msgs = sr ? Array.from(sr.querySelectorAll('.message, [class*="message"], [class*="bubble"]')).map(m => m.textContent?.trim()).filter(Boolean) : [];
    const turnstileDiv = document.getElementById('styleflo-turnstile-container');
    return {
      hasTurnstileGlobal: !!window.turnstile,
      turnstileDiv: !!turnstileDiv,
      turnstileDivHTML: turnstileDiv ? turnstileDiv.innerHTML : null,
      messages: msgs.slice(-5)
    };
  });
  console.log('Final state:', JSON.stringify(finalState, null, 2));

  await browser.close();
}

run().catch(console.error);
