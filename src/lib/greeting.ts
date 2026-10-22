/**
 * Greeting helper for StyleFlo chatbots (STYL-185).
 * Formats the initial greeting line for chat and web voice with "Hi [first name],"
 * and provides normalisation for transcript echo filtering.
 *
 * Rules:
 * - Pure TypeScript: zero DOM dependencies so it can be bundled into widget / embed and run on server.
 * - British English spelling in all user-facing strings.
 */

export interface BuildGreetingOptions {
  welcomeMessage?: string | null;
  agentName?: string | null;
  businessName?: string | null;
  clientName?: string | null;
}

/**
 * Extracts and capitalises the first name from client input.
 * Strips HTML tags/characters, limits to 40 characters, and treats email addresses as no name.
 * Returns null (never 'there' or 'null') when no valid name is provided.
 */
export function getFirstName(fullName?: string | null): string | null {
  if (!fullName || typeof fullName !== 'string') return null;

  // Strip HTML tags and < / > characters to prevent injection
  const stripped = fullName.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim();
  if (!stripped) return null;

  // If the string contains '@', treat as an email address (i.e. no first name)
  if (stripped.includes('@')) {
    return null;
  }

  // Take the trimmed first word
  const firstWord = stripped.split(/\s+/)[0];
  if (!firstWord) return null;

  const truncated = firstWord.slice(0, 40);
  if (!truncated) return null;

  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}

/**
 * Builds the personalized greeting string for chat bubbles and web voice firstMessage.
 */
export function buildGreeting(options: BuildGreetingOptions): string {
  const { welcomeMessage, agentName, businessName, clientName } = options;

  const firstName = getFirstName(clientName);
  const agent = (agentName || '').trim() || 'AI Assistant';
  const biz = (businessName || '').trim();

  let msg = (welcomeMessage || '').trim();

  // If welcome message is empty, use the agent-name default
  if (!msg) {
    if (biz) {
      msg = `Hi, I'm ${agent}, the AI assistant for ${biz}. How can I help you today?`;
    } else {
      msg = `Hi, I'm ${agent}. How can I help you today?`;
    }
  }

  // Replace chatbot name placeholders
  msg = msg.replace(/\[ChatbotName\]|\{ChatbotName\}|\[Chatbot Name\]|\{Chatbot Name\}/gi, agent);

  // Check for client name placeholders
  const namePlaceholderRegex = /\[Name\]|\{Name\}|\[ClientName\]|\{ClientName\}/i;
  const hasPlaceholder = namePlaceholderRegex.test(msg);

  if (hasPlaceholder) {
    if (firstName) {
      // Replace name placeholders with first name, do NOT prepend "Hi [name],"
      return msg.replace(/\[Name\]|\{Name\}|\[ClientName\]|\{ClientName\}/gi, firstName);
    } else {
      // Cleanly remove placeholder and trailing punctuation or leading space
      let cleaned = msg.replace(/\s*(?:\[Name\]|\{Name\}|\[ClientName\]|\{ClientName\})(?=\s*[,!.]?)/gi, '');
      cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/^[,!.\s]+/, '').trim();
      if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
      return cleaned;
    }
  }

  // If there is no first name, return message unchanged
  if (!firstName) {
    return msg;
  }

  // With a first name and no placeholder:
  // Remove one leading greeting word with punctuation:
  // Hi, Hello, Hey, Hiya, Good morning, Good afternoon, Good evening
  const leadingGreetingRegex = /^(?:Hi|Hello|Hey|Hiya|Good\s+morning|Good\s+afternoon|Good\s+evening)[,!.\s]+/i;
  let rest = msg.replace(leadingGreetingRegex, '').trim();
  if (!rest) {
    rest = 'how can I help you today?';
  }

  // Determine whether to lower-case the first letter of rest:
  // Keep capital if:
  // - it starts with "I" / "I'm" / "I've"
  // - or starts with agentName / businessName
  // - or first word contains a capital after its first letter (e.g. FloChat, AI)
  let shouldKeepCapital = false;

  if (/^I(?:['’](?:m|ve))?(?:\s|$|[.,!?])/i.test(rest)) {
    shouldKeepCapital = true;
  }

  if (agent && rest.toLowerCase().startsWith(agent.toLowerCase())) {
    shouldKeepCapital = true;
  }

  if (biz && rest.toLowerCase().startsWith(biz.toLowerCase())) {
    shouldKeepCapital = true;
  }

  const firstWordMatch = rest.match(/^[^\s]+/);
  if (firstWordMatch) {
    const cleanFirstWord = firstWordMatch[0].replace(/^[^\w]+|[^\w]+$/g, '');
    if (cleanFirstWord.length > 1 && /[A-Z]/.test(cleanFirstWord.slice(1))) {
      shouldKeepCapital = true;
    }
  }

  if (!shouldKeepCapital) {
    rest = rest.charAt(0).toLowerCase() + rest.slice(1);
  }

  return `Hi ${firstName}, ${rest}`;
}

/**
 * Normalises text for case- and punctuation-insensitive echo comparison.
 */
export function normalizeForEcho(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether an incoming voice transcript turn is an acoustic echo of the assistant's greeting.
 */
export function isEchoOfGreeting(transcript: string, greeting: string): boolean {
  if (!transcript || !greeting) return false;
  const normQuery = normalizeForEcho(transcript);
  const normGreeting = normalizeForEcho(greeting);

  if (normQuery.length < 8 || normGreeting.length < 8) return false;

  return normGreeting.includes(normQuery) || normQuery.includes(normGreeting);
}
