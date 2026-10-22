import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function parseSse(raw: string) {
  const lines = raw.split('\n');
  const chunks: any[] = [];
  let isDone = false;
  for (const line of lines) {
    if (line.startsWith('data: [DONE]')) {
      isDone = true;
    } else if (line.startsWith('data: ')) {
      try {
        chunks.push(JSON.parse(line.slice(6)));
      } catch (e) {}
    }
  }
  const contentDeltas = chunks
    .map((c) => c.choices?.[0]?.delta?.content)
    .filter((c): c is string => typeof c === 'string' && c.length > 0);
  const stopChunks = chunks.filter((c) => c.choices?.[0]?.finish_reason === 'stop');
  return { chunks, isDone, contentDeltas, stopChunks };
}

test.describe('STYL-188: Voice Availability Tool & Stream Robustness', () => {
  const seedBotId = 'e0000000-0000-0000-0000-000000000001';
  const validServiceId = '40000000-0000-0000-0000-000000000001';

  test('voice availability check with valid service completes cleanly with one holding phrase and second-pass reply', async ({ request }) => {
    const sessionId = `test_voice_avail_${Date.now()}`;
    const holdingLine = 'Let me check availability for you.';
    const pass2Reply = 'We have availability on Friday at 2:00 PM with Sarah Miller. Would you like me to book that for you?';

    const res = await request.post(`/api/voice/${seedBotId}/chat/completions`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        sessionId,
        messages: [
          { role: 'user', content: 'Can I book an appointment for tomorrow at 2pm?' }
        ],
        mockModelReply: `${holdingLine} [CHECK_AVAILABILITY: ANY, ${validServiceId}, 2026-10-23T14:00:00+01:00, 2026-10-23T15:00:00+01:00]`,
        mockPass2Reply: pass2Reply,
      }
    });

    expect(res.status()).toBe(200);
    const bodyText = await res.text();
    const parsed = parseSse(bodyText);

    // 1. Verify stream finished cleanly with stop and [DONE] without throwing
    expect(parsed.isDone).toBe(true);
    expect(parsed.stopChunks.length).toBe(1);

    // 2. Exactly one holding phrase is spoken before second-pass text
    expect(parsed.contentDeltas).toEqual([
      holdingLine,
      pass2Reply,
    ]);

    // 3. Transcript in database shows only what was spoken (holding line + post-check reply), not bracket codes
    await expect.poll(async () => {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('user_session_id', sessionId)
        .maybeSingle();

      if (!conv?.id) return null;

      const { data: messages } = await supabaseAdmin
        .from('messages')
        .select('sender_type, text_content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true });

      const botMessage = messages?.find((m) => m.sender_type === 'bot');
      return botMessage?.text_content || null;
    }, { timeout: 10000 }).toBe(`${holdingLine} ${pass2Reply}`);
  });

  test('unknown service ID ends cleanly with a fallback line and finish_reason stop', async ({ request }) => {
    const sessionId = `test_voice_unknown_svc_${Date.now()}`;
    const unknownServiceId = '00000000-0000-0000-0000-000000999999';

    const res = await request.post(`/api/voice/${seedBotId}/chat/completions`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        sessionId,
        messages: [
          { role: 'user', content: 'Can I book an unknown service?' }
        ],
        mockModelReply: `Checking that for you now... [CHECK_AVAILABILITY: ANY, ${unknownServiceId}, 2026-10-23T14:00:00+01:00, 2026-10-23T15:00:00+01:00]`,
      }
    });

    expect(res.status()).toBe(200);
    const bodyText = await res.text();
    const parsed = parseSse(bodyText);

    // Stream ends cleanly with stop and [DONE]
    expect(parsed.isDone).toBe(true);
    expect(parsed.stopChunks.length).toBe(1);

    // Spoken content contains one holding line and the clean fallback speech
    expect(parsed.contentDeltas.length).toBe(2);
    expect(parsed.contentDeltas[0]).toBe('Checking that for you now...');
    expect(parsed.contentDeltas[1]).toContain("couldn't find that specific service");

    // Database record contains the fallback line, no crash
    await expect.poll(async () => {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('user_session_id', sessionId)
        .maybeSingle();

      if (!conv?.id) return null;

      const { data: messages } = await supabaseAdmin
        .from('messages')
        .select('sender_type, text_content')
        .eq('conversation_id', conv.id);

      const botMessage = messages?.find((m) => m.sender_type === 'bot');
      return botMessage?.text_content || null;
    }, { timeout: 10000 }).toContain("couldn't find that specific service");
  });

  test('when model output has no pre-bracket text, exactly one holding line is streamed', async ({ request }) => {
    const sessionId = `test_voice_no_pre_${Date.now()}`;
    const pass2Reply = 'I found an appointment at 3:00 PM.';

    const res = await request.post(`/api/voice/${seedBotId}/chat/completions`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        sessionId,
        messages: [
          { role: 'user', content: 'Book for 3pm please' }
        ],
        mockModelReply: `[CHECK_AVAILABILITY: ANY, ${validServiceId}, 2026-10-23T15:00:00+01:00, 2026-10-23T16:00:00+01:00]`,
        mockPass2Reply: pass2Reply,
      }
    });

    expect(res.status()).toBe(200);
    const bodyText = await res.text();
    const parsed = parseSse(bodyText);

    expect(parsed.isDone).toBe(true);
    expect(parsed.stopChunks.length).toBe(1);

    // Exactly one holding line streamed ("Let me check availability...") + pass 2 reply
    expect(parsed.contentDeltas.length).toBe(2);
    expect(parsed.contentDeltas[0]).toBe('Let me check availability for that slot for you right now... ');
    expect(parsed.contentDeltas[1]).toBe(pass2Reply);
  });
});
