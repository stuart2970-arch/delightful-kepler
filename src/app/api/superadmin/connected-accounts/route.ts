import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {}
      },
    });

    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await authClient
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_super_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // 1. Fetch saved keys from global settings bot
    const globalBotId = '00000000-0000-0000-0000-000000000000';
    const { data: globalBot } = await adminClient
      .from('chatbots')
      .select('configuration_json')
      .eq('id', globalBotId)
      .maybeSingle();

    const savedKeys = globalBot?.configuration_json?.connected_account_keys || {};
    const defaultGeminiModel = globalBot?.configuration_json?.default_gemini_model || 'gemini-3.6-flash';

    // Resolved API keys (Env takes priority, fallback to DB saved keys)
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY || savedKeys.elevenlabs_api_key || '';
    const vapiKey = process.env.VAPI_API_KEY || process.env.VAPI_PRIVATE_KEY || process.env.VAPI_SECRET_KEY || savedKeys.vapi_api_key || '';
    const twilioSid = process.env.TWILIO_ACCOUNT_SID || savedKeys.twilio_account_sid || '';
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || savedKeys.twilio_auth_token || '';
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY || savedKeys.gemini_api_key || '';
    const gcpProjectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || savedKeys.gcp_project_id || '';

    // Results container
    const providerResults: Record<string, any> = {
      elevenlabs: {
        configured: !!elevenLabsKey,
        keyMasked: elevenLabsKey ? `${elevenLabsKey.substring(0, 4)}...${elevenLabsKey.slice(-4)}` : '',
        status: 'unknown',
        tier: 'N/A',
        characterCount: 0,
        characterLimit: 0,
        charactersRemaining: 0,
        percentRemaining: 0,
        estimatedVoiceMinutesRemaining: 0,
        nextResetDate: null,
        isLow: false,
        warningReason: null,
        rawError: null,
      },
      vapi: {
        configured: !!vapiKey,
        keyMasked: vapiKey ? `${vapiKey.substring(0, 4)}...${vapiKey.slice(-4)}` : '',
        status: 'unknown',
        orgName: 'N/A',
        orgId: 'N/A',
        creditBalance: null,
        currency: 'USD',
        concurrencyLimit: 0,
        estimatedVoiceMinutesRemaining: 0,
        isLow: false,
        warningReason: null,
        rawError: null,
      },
      twilio: {
        configured: !!(twilioSid && twilioAuthToken),
        accountSidMasked: twilioSid ? `${twilioSid.substring(0, 4)}...${twilioSid.slice(-4)}` : '',
        status: 'unknown',
        accountType: 'N/A',
        balance: null,
        currency: 'USD',
        estimatedSmsRemaining: 0,
        estimatedVoiceMinutesRemaining: 0,
        isLow: false,
        warningReason: null,
        rawError: null,
      },
      googleCloud: {
        configured: !!geminiKey,
        keyMasked: geminiKey ? `${geminiKey.substring(0, 4)}...${geminiKey.slice(-4)}` : '',
        projectId: gcpProjectId || 'styleflo-ai-prod',
        status: 'unknown',
        activeModel: defaultGeminiModel,
        tokensUsedThisMonth: 0,
        messagesProcessedThisMonth: 0,
        estimatedCostUsd: 0,
        rateLimitTpm: '1,000,000 TPM',
        rateLimitRpd: '1,500 RPD',
        isLow: false,
        warningReason: null,
        rawError: null,
      },
    };

    // Parallel execution of provider API calls
    const [elevenLabsRes, vapiRes, twilioRes, googleDbRes] = await Promise.allSettled([
      // 1. ElevenLabs API
      (async () => {
        if (!elevenLabsKey) throw new Error('No API Key configured');
        const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
          headers: { 'xi-api-key': elevenLabsKey },
          cache: 'no-store',
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`ElevenLabs API returned ${res.status}: ${errText || res.statusText}`);
        }
        return await res.json();
      })(),

      // 2. Vapi API
      (async () => {
        const cleanVapiKey = (vapiKey || '').trim().replace(/^Bearer\s+/i, '').replace(/["']/g, '');
        if (!cleanVapiKey) throw new Error('No Vapi API Key configured');

        const headers = { 'Authorization': `Bearer ${cleanVapiKey}` };

        // Test 1: Fetch Org details
        const orgRes = await fetch('https://api.vapi.ai/org', { headers, cache: 'no-store' });
        if (orgRes.ok) {
          return await orgRes.json();
        }

        // Test 2: Fetch Assistants list (supported by Private Key)
        const assistantRes = await fetch('https://api.vapi.ai/assistant?limit=1', { headers, cache: 'no-store' });
        if (assistantRes.ok) {
          const assistantData = await assistantRes.json();
          return {
            name: 'Vapi Voice Account',
            creditBalance: null,
            concurrencyLimit: 10,
            assistantsCount: Array.isArray(assistantData) ? assistantData.length : 1,
          };
        }

        // Test 3: Fetch Calls list
        const callRes = await fetch('https://api.vapi.ai/call?limit=1', { headers, cache: 'no-store' });
        if (callRes.ok) {
          return {
            name: 'Vapi Voice Account',
            creditBalance: null,
            concurrencyLimit: 10,
          };
        }

        if (orgRes.status === 401 || assistantRes.status === 401 || callRes.status === 401) {
          throw new Error('Vapi returned 401 (Unauthorized). Ensure you copied the Private Key from dashboard.vapi.ai/org and trimmed trailing spaces.');
        }

        const errText = await orgRes.text().catch(() => '');
        throw new Error(`Vapi API returned ${orgRes.status}: ${errText || orgRes.statusText}`);
      })(),

      // 3. Twilio API
      (async () => {
        if (!twilioSid || !twilioAuthToken) throw new Error('No Account SID / Auth Token configured');
        const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString('base64');
        const balanceRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Balance.json`, {
          headers: { 'Authorization': authHeader },
          cache: 'no-store',
        });
        
        let balanceData: any = {};
        if (balanceRes.ok) {
          balanceData = await balanceRes.json();
        } else {
          const errText = await balanceRes.text().catch(() => '');
          throw new Error(`Twilio Balance API returned ${balanceRes.status}: ${errText}`);
        }

        const accountRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}.json`, {
          headers: { 'Authorization': authHeader },
          cache: 'no-store',
        });
        let accountData: any = {};
        if (accountRes.ok) {
          accountData = await accountRes.json();
        }

        return { balanceData, accountData };
      })(),

      // 4. Google Cloud / Gemini API & Supabase Telemetry
      (async () => {
        let apiOk = false;
        let apiError = '';
        if (geminiKey) {
          try {
            const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, {
              cache: 'no-store',
            });
            if (modelsRes.ok) {
              apiOk = true;
            } else {
              apiError = `Google API returned ${modelsRes.status}`;
            }
          } catch (e: any) {
            apiError = e.message || 'Network error pinging Google API';
          }
        }

        // Aggregate token usage from usage_ledger and messages in current month
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const [usageRes, msgsRes] = await Promise.all([
          adminClient.from('usage_ledger').select('quantity').gte('created_at', firstDayOfMonth),
          adminClient.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', firstDayOfMonth),
        ]);

        const totalTokens = (usageRes.data || []).reduce((acc: number, item: any) => acc + Number(item.quantity || 0), 0);
        const totalMsgs = msgsRes.count || 0;

        return { apiOk, apiError, totalTokens, totalMsgs };
      })(),
    ]);

    // Process ElevenLabs Result
    if (elevenLabsRes.status === 'fulfilled') {
      const data = elevenLabsRes.value;
      const count = Number(data.character_count || 0);
      const limit = Number(data.character_limit || 0);
      const remaining = Math.max(0, limit - count);
      const pct = limit > 0 ? Math.round((remaining / limit) * 100) : 0;
      const estMins = Math.round(remaining / 1000); // 1,000 chars ~ 1 min audio

      const isLow = pct < 20 || remaining < 15000;
      let warningReason: string | null = null;
      if (pct < 10) warningReason = `Critical: Only ${pct}% (${remaining.toLocaleString()} chars) remaining!`;
      else if (isLow) warningReason = `Low Quota: ${pct}% (${remaining.toLocaleString()} chars) remaining.`;

      providerResults.elevenlabs = {
        ...providerResults.elevenlabs,
        status: data.status || 'active',
        tier: data.tier || 'Standard',
        characterCount: count,
        characterLimit: limit,
        charactersRemaining: remaining,
        percentRemaining: pct,
        estimatedVoiceMinutesRemaining: estMins,
        nextResetDate: data.next_character_count_reset_unix 
          ? new Date(data.next_character_count_reset_unix * 1000).toLocaleDateString()
          : null,
        isLow,
        warningReason,
      };
    } else {
      providerResults.elevenlabs.status = 'error';
      providerResults.elevenlabs.rawError = elevenLabsRes.reason?.message || 'Failed to communicate with ElevenLabs';
    }

    // Process Vapi Result
    if (vapiRes.status === 'fulfilled') {
      const data = vapiRes.value;
      const orgObj = Array.isArray(data) ? data[0] : data;
      
      const balance = orgObj?.creditBalance ?? orgObj?.balance ?? null;
      const balanceNum = balance !== null && balance !== undefined ? parseFloat(String(balance)) : null;
      const concurrency = orgObj?.concurrencyLimit ?? 10;
      const estMins = balanceNum !== null ? Math.floor(balanceNum / 0.05) : null; // ~5 cents per min if prepaid, null if pay-as-you-go

      const isLow = balanceNum !== null && balanceNum < 15.00;
      let warningReason: string | null = null;
      if (balanceNum !== null && balanceNum < 5.00) warningReason = `Critical: Credit balance is only $${balanceNum.toFixed(2)}!`;
      else if (isLow) warningReason = `Low Credit: Balance is $${balanceNum?.toFixed(2)}. Top up recommended.`;

      providerResults.vapi = {
        ...providerResults.vapi,
        status: 'active',
        orgName: orgObj?.name || 'Vapi Voice Account',
        orgId: orgObj?.id || 'N/A',
        creditBalance: balanceNum,
        currency: orgObj?.currency || 'USD',
        concurrencyLimit: concurrency,
        estimatedVoiceMinutesRemaining: estMins,
        isLow,
        warningReason,
      };
    } else {
      providerResults.vapi.status = 'error';
      providerResults.vapi.rawError = vapiRes.reason?.message || 'Failed to communicate with Vapi';
    }

    // Process Twilio Result
    if (twilioRes.status === 'fulfilled') {
      const { balanceData, accountData } = twilioRes.value;
      const balanceNum = parseFloat(balanceData.balance || '0');
      const currency = balanceData.currency || 'USD';
      const currencySymbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';

      const estSms = Math.floor(balanceNum / 0.04); // ~4 cents per SMS
      const estVoiceMins = Math.floor(balanceNum / 0.02); // ~2 cents per min

      const isLow = balanceNum < 10.00;
      let warningReason: string | null = null;
      if (balanceNum < 2.00) warningReason = `Critical: Account balance is ${currencySymbol}${balanceNum.toFixed(2)}! SMS/Calls will fail soon.`;
      else if (isLow) warningReason = `Low Balance: ${currencySymbol}${balanceNum.toFixed(2)} left in Twilio account.`;

      providerResults.twilio = {
        ...providerResults.twilio,
        status: accountData.status || 'active',
        accountType: accountData.type || 'Full Account',
        balance: balanceNum,
        currency,
        estimatedSmsRemaining: estSms,
        estimatedVoiceMinutesRemaining: estVoiceMins,
        isLow,
        warningReason,
      };
    } else {
      providerResults.twilio.status = 'error';
      providerResults.twilio.rawError = twilioRes.reason?.message || 'Failed to communicate with Twilio';
    }

    // Process Google Cloud / Gemini Result
    if (googleDbRes.status === 'fulfilled') {
      const { apiOk, apiError, totalTokens, totalMsgs } = googleDbRes.value;
      const estCost = ((totalTokens / 1_000_000) * 0.075) + ((totalMsgs * 0.001));

      const isLow = !apiOk && !!geminiKey;
      let warningReason: string | null = null;
      if (!apiOk && geminiKey) warningReason = `API Warning: Google API check failed (${apiError}). Quota or key issue.`;

      providerResults.googleCloud = {
        ...providerResults.googleCloud,
        status: apiOk ? 'active' : geminiKey ? 'degraded' : 'unconfigured',
        tokensUsedThisMonth: totalTokens,
        messagesProcessedThisMonth: totalMsgs,
        estimatedCostUsd: parseFloat(estCost.toFixed(4)),
        isLow,
        warningReason,
        rawError: apiError || null,
      };
    }

    // Calculate total services with low alerts
    const lowServicesCount = Object.values(providerResults).filter(p => p.isLow || p.status === 'error').length;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      lowServicesCount,
      providers: providerResults,
      savedKeysConfigured: {
        elevenlabs: !!savedKeys.elevenlabs_api_key,
        vapi: !!savedKeys.vapi_api_key,
        twilio: !!(savedKeys.twilio_account_sid && savedKeys.twilio_auth_token),
        gemini: !!savedKeys.gemini_api_key,
        gcpProject: !!savedKeys.gcp_project_id,
      }
    });
  } catch (err: any) {
    console.error('[Connected Accounts API] Error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {}
      },
    });

    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await authClient
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_super_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { 
      elevenlabs_api_key, 
      vapi_api_key, 
      twilio_account_sid, 
      twilio_auth_token, 
      gemini_api_key,
      gcp_project_id 
    } = body;

    const adminClient = createClient(supabaseUrl, serviceKey);
    const globalBotId = '00000000-0000-0000-0000-000000000000';
    const globalTenantId = '00000000-0000-0000-0000-000000000000';

    // Ensure system tenant
    await adminClient
      .from('tenants')
      .upsert({
        id: globalTenantId,
        tenant_id: globalTenantId,
        company_name: 'GLOBAL_PLATFORM_SYSTEM'
      }, { onConflict: 'id' });

    // Fetch existing bot config
    const { data: existingBot } = await adminClient
      .from('chatbots')
      .select('configuration_json')
      .eq('id', globalBotId)
      .maybeSingle();

    const existingKeys = existingBot?.configuration_json?.connected_account_keys || {};

    const updatedKeys = {
      ...existingKeys,
      ...(elevenlabs_api_key !== undefined && { elevenlabs_api_key: elevenlabs_api_key.trim() }),
      ...(vapi_api_key !== undefined && { vapi_api_key: vapi_api_key.trim() }),
      ...(twilio_account_sid !== undefined && { twilio_account_sid: twilio_account_sid.trim() }),
      ...(twilio_auth_token !== undefined && { twilio_auth_token: twilio_auth_token.trim() }),
      ...(gemini_api_key !== undefined && { gemini_api_key: gemini_api_key.trim() }),
      ...(gcp_project_id !== undefined && { gcp_project_id: gcp_project_id.trim() }),
    };

    const newConfig = {
      ...(existingBot?.configuration_json || {}),
      connected_account_keys: updatedKeys,
    };

    const { error } = await adminClient
      .from('chatbots')
      .upsert({
        id: globalBotId,
        tenant_id: globalTenantId,
        name: 'GLOBAL_PLATFORM_SETTINGS',
        primary_color: '#000000',
        configuration_json: newConfig
      }, { onConflict: 'id' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Connected account API keys saved successfully!' });
  } catch (err: any) {
    console.error('[Connected Accounts Save API] Error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
