import Vapi from '@vapi-ai/web';

(function () {
  // 1. Identify the script element and extract configuration
  const currentScript = document.currentScript as HTMLScriptElement;
  if (!currentScript) {
    console.error('[StyleFlo Widget] Current script context not found.');
    return;
  }

  const chatbotId = currentScript.getAttribute('data-bot-id');
  if (!chatbotId) {
    console.error('[StyleFlo Widget] Missing required "data-bot-id" attribute on script tag.');
    return;
  }

  // Parse host URL from script source
  const scriptUrl = new URL(currentScript.src);
  const apiHost = scriptUrl.origin;

  // 2. Generate or retrieve Session ID to preserve chat history
  const sessionKey = `styleflo_session_${chatbotId}`;
  let sessionId = localStorage.getItem(sessionKey);
  if (!sessionId) {
    sessionId = 'session_' + crypto.randomUUID();
    localStorage.setItem(sessionKey, sessionId);
  }

  // 3. Create the Shadow Host container in body
  const host = document.createElement('div');
  host.id = 'styleflo-chat-widget';
  host.style.position = 'fixed';
  host.style.bottom = '0';
  host.style.right = '0';
  host.style.zIndex = '999999';
  document.body.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });

  // 4. Inject Tailwind Stylesheet & Custom CSS inside the Shadow Root
  const tailwindLink = document.createElement('link');
  tailwindLink.rel = 'stylesheet';
  tailwindLink.href = 'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css';
  shadowRoot.appendChild(tailwindLink);

  const styleTag = document.createElement('style');
  styleTag.textContent = `
    @keyframes styleflo-bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    .styleflo-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      background-color: #9CA3AF;
      border-radius: 50%;
      animation: styleflo-bounce 1.4s infinite ease-in-out;
    }
    .styleflo-dot:nth-child(2) { animation-delay: 0.2s; }
    .styleflo-dot:nth-child(3) { animation-delay: 0.4s; }

    /* Custom scrollbar styles */
    .styleflo-scrollbar::-webkit-scrollbar {
      width: 4px;
    }
    .styleflo-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .styleflo-scrollbar::-webkit-scrollbar-thumb {
      background-color: #D1D5DB;
      border-radius: 2px;
    }
    .styleflo-scrollbar {
      scrollbar-width: thin;
      scrollbar-color: #D1D5DB transparent;
    }

    /* Custom sizing since Tailwind v2 CDN doesn't support arbitrary values */
    .styleflo-chat-window {
      width: calc(100vw - 40px);
      height: 550px;
      max-height: calc(100vh - 100px);
    }
    @supports (max-height: 100dvh) {
      .styleflo-chat-window {
        max-height: calc(100dvh - 100px);
      }
    }
    @media (min-width: 640px) {
      .styleflo-chat-window {
        width: 380px;
      }
    }
    .styleflo-text-17 { font-size: 17px; }
    .styleflo-text-15 { font-size: 15px; }
    .styleflo-text-11 { font-size: 11px; }
    .styleflo-mw-85 { max-width: 85%; width: fit-content; }
    .styleflo-mw-75 { max-width: 75%; width: fit-content; }

    @keyframes styleflo-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: .4; }
    }
    .styleflo-animate-pulse {
      animation: styleflo-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
  `;
  shadowRoot.appendChild(styleTag);

  // 5. Setup Widget HTML layout template
  const widgetContainer = document.createElement('div');
  widgetContainer.className = 'font-sans';
  shadowRoot.appendChild(widgetContainer);

  let primaryColor = '#4F46E5'; // Default Indigo-600
  let botName = 'AI Assistant';
  let agentName = 'AI Assistant';
  let agentRole = 'AI Support Agent';
  let agentAvatarUrl = '/avatars/avatar1.png';

  let welcomeMessage = 'Hello! How can I help you today?';
  let brandingHtml = '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>';
  let voiceEnabled = false;
  let vapiPublicKey = '';
  let vapiAssistantId = '';
  let globalVoiceDisclaimer = '';
  let voiceProvider = 'playht';
  let voiceId = 'bIHbv24MWmeRgasZH58o';

  // 6. Fetch Chatbot Public Configuration
  async function fetchConfig() {
    try {
      const response = await fetch(`${apiHost}/api/chatbots/${chatbotId}`);
      if (response.ok) {
        const config = await response.json();
        if (config.name) botName = config.name;
        if (config.primaryColor) primaryColor = config.primaryColor;
        agentName = config.agentName || botName;
        agentRole = config.agentRole || 'AI Support Agent';
        agentAvatarUrl = config.agentAvatarUrl || '/avatars/avatar1.png';
        welcomeMessage = config.welcomeMessage || 'Hello! How can I help you today?';
        brandingHtml = config.brandingHtml || brandingHtml;
        voiceEnabled = config.voiceEnabled || false;
        vapiPublicKey = config.vapiPublicKey || '';
        vapiAssistantId = config.vapiAssistantId || '';
        globalVoiceDisclaimer = config.globalVoiceDisclaimer || '';
        if (config.voiceProvider) voiceProvider = config.voiceProvider;
        if (config.voiceId) voiceId = config.voiceId;
      }
    } catch (err) {
      console.warn('[StyleFlo Widget] Failed to fetch chatbot config, using defaults:', err);
    }
    initializeWidget();
  }

  // 7. Initialize and render the DOM elements
  function initializeWidget() {
    // Floating Chat Bubble
    const bubble = document.createElement('button');
    bubble.className = 'fixed bottom-5 right-5 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 focus:outline-none z-50';
    bubble.style.backgroundColor = primaryColor;
    bubble.innerHTML = `
      <!-- Chat Icon -->
      <svg id="styleflo-icon-chat" class="w-6 h-6 text-white transition-all duration-300 transform scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
      <!-- Close Icon (Initially hidden) -->
      <svg id="styleflo-icon-close" class="w-6 h-6 text-white absolute transition-all duration-300 transform scale-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `;
    widgetContainer.appendChild(bubble);

    // Chat Window
    const chatWindow = document.createElement('div');
    chatWindow.className = 'fixed z-50 flex flex-col bg-white overflow-hidden transition-all duration-300 transform scale-90 opacity-0 pointer-events-none origin-bottom-right bottom-20 right-5 rounded-2xl border border-gray-100 shadow-2xl styleflo-chat-window';
    chatWindow.innerHTML = `
      <!-- Header -->
      <div class="p-4 text-white flex items-center justify-between shadow-md shrink-0 z-10" style="background-color: ${primaryColor};">
        <div class="flex items-center gap-3">
          <img src="${apiHost}${agentAvatarUrl}" alt="Agent Avatar" class="w-10 h-10 rounded-full border border-white/20 bg-white/10 object-cover" />
          <div>
            <h3 class="font-bold styleflo-text-17 leading-tight">${agentName}</h3>
            <p class="styleflo-text-11 opacity-75 mt-0.5">${agentRole}</p>
          </div>
        </div>
        <button id="styleflo-close-btn" class="text-white opacity-80 hover:opacity-100 focus:outline-none transition-opacity">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <!-- Onboarding Area -->
      <div id="styleflo-onboarding" class="flex-1 flex flex-col items-center justify-center p-6 bg-gray-50 text-center" style="display: none; overflow-y: auto;">
        <div class="w-16 h-16 shrink-0 rounded-full flex items-center justify-center mb-4 text-white shadow-lg" style="background-color: ${primaryColor};">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h4 class="font-bold text-gray-800 text-lg mb-2 shrink-0">Welcome!</h4>
        <p class="text-gray-500 text-sm mb-4 shrink-0">Please enter your name to start.</p>
        
        ${globalVoiceDisclaimer ? `
          <div class="w-full bg-blue-50/50 border border-blue-100 p-3 rounded-xl mb-4 text-left">
            <p class="text-xs text-blue-900/80 leading-relaxed">${globalVoiceDisclaimer}</p>
          </div>
        ` : ''}

        <form id="styleflo-onboarding-form" class="w-full shrink-0">
          <input type="text" id="styleflo-onboarding-name" required placeholder="Name" class="w-full px-4 py-3 mb-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all" style="--tw-ring-color: ${primaryColor};" />
          
          ${globalVoiceDisclaimer ? `
          <div class="flex items-start gap-2 mb-4 text-left">
            <input type="checkbox" id="styleflo-disclaimer-accept" required class="mt-1" />
            <label for="styleflo-disclaimer-accept" class="text-xs text-gray-600">I have read and accept the disclaimer above.</label>
          </div>
          ` : ''}

          <button type="submit" class="w-full py-3 rounded-xl text-white font-semibold shadow-md transition-opacity hover:opacity-95" style="background-color: ${primaryColor};">Start Chatting</button>
        </form>
      </div>

      <!-- Messages Area -->
      <div id="styleflo-messages" class="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 space-y-4 bg-gray-50 styleflo-scrollbar">
        <!-- Welcome Message -->
        <div class="flex items-start gap-2.5 w-full">
          <img src="${apiHost}${agentAvatarUrl}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0" />
          <div class="p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 styleflo-mw-75 shadow-sm leading-relaxed w-full">
            ${welcomeMessage}
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <form id="styleflo-chat-form" class="p-3 bg-white border-t border-gray-100 flex items-center gap-2 shrink-0 z-10">
        ${voiceEnabled ? `
        <button 
          type="button" 
          id="styleflo-vapi-btn"
          class="p-2 rounded-xl text-white focus:outline-none transition-all flex-shrink-0" 
          style="background-color: #6B7280; width: 36px; height: 36px;"
          title="Talk to Bot"
        >
          <svg class="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
          </svg>
        </button>
        ` : ''}
        <input 
          id="styleflo-input" 
          type="text" 
          placeholder="Type your message..." 
          class="flex-1 px-3 py-2 styleflo-text-15 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all"
          style="--tw-ring-color: ${primaryColor};"
          autocomplete="off"
        />
        <button 
          type="submit" 
          class="p-2 rounded-xl text-white hover:opacity-95 focus:outline-none transition-opacity" 
          style="background-color: ${primaryColor};"
        >
          <svg class="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
          </svg>
        </button>
      </form>

      <!-- Branding Footer -->
      <a href="${apiHost}/api/track?ref=${chatbotId}&source=${encodeURIComponent(window.location.hostname)}" target="_blank" rel="noopener noreferrer" class="w-full bg-gray-50 text-center py-1.5 border-t border-gray-100 block hover:bg-gray-100 transition-colors cursor-pointer text-gray-500 flex items-center justify-center">
        ${brandingHtml}
      </a>
    `;
    widgetContainer.appendChild(chatWindow);

    // References to DOM elements inside Shadow DOM
    const messagesContainer = shadowRoot.getElementById('styleflo-messages') as HTMLDivElement;
    const chatForm = shadowRoot.getElementById('styleflo-chat-form') as HTMLFormElement;
    const inputField = shadowRoot.getElementById('styleflo-input') as HTMLInputElement;
    const closeBtn = shadowRoot.getElementById('styleflo-close-btn') as HTMLButtonElement;
    const chatIcon = shadowRoot.getElementById('styleflo-icon-chat') as HTMLElement;
    const closeIcon = shadowRoot.getElementById('styleflo-icon-close') as HTMLElement;
    const onboardingContainer = shadowRoot.getElementById('styleflo-onboarding') as HTMLDivElement;
    const onboardingForm = shadowRoot.getElementById('styleflo-onboarding-form') as HTMLFormElement;
    const onboardingName = shadowRoot.getElementById('styleflo-onboarding-name') as HTMLInputElement;
    const vapiBtn = shadowRoot.getElementById('styleflo-vapi-btn') as HTMLButtonElement | null;

    let vapiInstance: Vapi | null = null;
    let isVapiActive = false;

    // Check for existing name in localStorage
    let storedName = localStorage.getItem('styleflo-client-name');
    let disclaimerAccepted = localStorage.getItem('styleflo-disclaimer-accepted');
    
    // If we need a disclaimer but it hasn't been accepted, force onboarding
    if (!storedName || (globalVoiceDisclaimer && !disclaimerAccepted)) {
      messagesContainer.style.display = 'none';
      chatForm.style.display = 'none';
      onboardingContainer.style.display = 'flex';
      
      // If we already have a name, prepopulate the name field
      if (storedName && onboardingName) {
        onboardingName.value = storedName;
      }
    }

    onboardingForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = onboardingName.value.trim();
      const acceptCheckbox = shadowRoot.getElementById('styleflo-disclaimer-accept') as HTMLInputElement | null;
      
      if (globalVoiceDisclaimer && acceptCheckbox && !acceptCheckbox.checked) {
        alert('You must accept the disclaimer to continue.');
        return;
      }

      if (name) {
        localStorage.setItem('styleflo-client-name', name);
        if (globalVoiceDisclaimer) {
          localStorage.setItem('styleflo-disclaimer-accepted', 'true');
          disclaimerAccepted = 'true';
        }
        storedName = name;
        onboardingContainer.style.display = 'none';
        messagesContainer.style.display = 'block';
        chatForm.style.display = 'flex';
        inputField.focus();
      }
    });

    let isOpen = false;

    // Toggle Chat Window
    function toggleChat() {
      isOpen = !isOpen;
      if (isOpen) {
        chatWindow.classList.remove('scale-90', 'opacity-0', 'pointer-events-none');
        chatWindow.classList.add('scale-100', 'opacity-100', 'pointer-events-auto');
        chatIcon.classList.remove('scale-100');
        chatIcon.classList.add('scale-0');
        closeIcon.classList.remove('scale-0');
        closeIcon.classList.add('scale-100');
        inputField.focus();
      } else {
        chatWindow.classList.remove('scale-100', 'opacity-100', 'pointer-events-auto');
        chatWindow.classList.add('scale-90', 'opacity-0', 'pointer-events-none');
        chatIcon.classList.remove('scale-0');
        chatIcon.classList.add('scale-100');
        closeIcon.classList.remove('scale-100');
        closeIcon.classList.add('scale-0');
        
        if (isVapiActive && vapiInstance) {
          vapiInstance.stop();
        }
      }
    }

    bubble.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);

    // Helper to scroll to bottom of messages container
    function scrollToBottom() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Helper to append a message node to UI
    function appendMessage(sender: 'user' | 'bot', text: string = ''): HTMLDivElement {
      const wrapper = document.createElement('div');
      wrapper.className = sender === 'user' ? 'flex justify-end w-full' : 'flex items-start gap-2.5 w-full';
      
      if (sender === 'bot') {
        const avatarImg = document.createElement('img');
        avatarImg.src = `${apiHost}${agentAvatarUrl}`;
        avatarImg.alt = 'Agent Avatar';
        avatarImg.className = 'w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0';
        wrapper.appendChild(avatarImg);
      }
      
      const msgDiv = document.createElement('div');
      msgDiv.className = sender === 'user'
        ? 'p-3 text-white rounded-2xl rounded-tr-none styleflo-text-15 styleflo-mw-85 shadow-sm leading-relaxed w-full'
        : 'p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 shadow-sm leading-relaxed w-full';
      
      if (sender === 'user') {
        msgDiv.style.backgroundColor = primaryColor;
        msgDiv.textContent = text;
        wrapper.appendChild(msgDiv);
      } else {
        const col = document.createElement('div');
        col.className = 'flex flex-col min-w-0 styleflo-mw-75';
        msgDiv.textContent = text;
        col.appendChild(msgDiv);
        wrapper.appendChild(col);
      }
      
      messagesContainer.appendChild(wrapper);
      scrollToBottom();
      return msgDiv;
    }

    // Helper to append typing indicator
    function showTypingIndicator(): HTMLDivElement {
      const wrapper = document.createElement('div');
      wrapper.id = 'styleflo-typing-indicator';
      wrapper.className = 'flex items-start gap-2.5';
      
      wrapper.innerHTML = `
        <img src="${apiHost}${agentAvatarUrl}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0" />
        <div class="flex items-center gap-1.5 p-3.5 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
        </div>
      `;
      messagesContainer.appendChild(wrapper);
      scrollToBottom();
      return wrapper;
    }

    // Initialize Vapi if enabled
    if (vapiBtn && voiceEnabled) {
      if (vapiPublicKey) {
        vapiInstance = new Vapi(vapiPublicKey);

        vapiInstance.on('call-start', () => {
          isVapiActive = true;
          vapiBtn.style.backgroundColor = primaryColor;
        });
        vapiInstance.on('call-end', () => {
          isVapiActive = false;
          vapiBtn.style.backgroundColor = '#6B7280';
          vapiBtn.classList.remove('styleflo-animate-pulse');
        });
        vapiInstance.on('speech-start', () => {
          vapiBtn.classList.add('styleflo-animate-pulse');
        });
        vapiInstance.on('speech-end', () => {
          vapiBtn.classList.remove('styleflo-animate-pulse');
        });
        vapiInstance.on('error', (e: unknown) => {
          console.error('[StyleFlo Widget] Vapi error:', e);
          try {
            alert('VAPI ERROR DETAILS: ' + JSON.stringify(e));
          } catch(err) {}
          appendMessage('bot', 'A voice connection error occurred.');
        });
      }

      vapiBtn.addEventListener('click', async () => {
        if (!vapiPublicKey) {
          alert('Missing Vapi Public Key in widget configuration.');
          return;
        }
        
        if (isVapiActive && vapiInstance) {
          vapiInstance.stop();
        } else if (vapiInstance) {
          try {
            if (vapiAssistantId) {
              await vapiInstance.start(vapiAssistantId);
            } else {
              // Use Transient Assistant
              await vapiInstance.start({
                name: `${agentName} Transient Assistant`,
                model: {
                  provider: "custom-llm",
                  url: `${apiHost}/api/voice/${chatbotId}/`,
                  model: "gemini-1.5-flash",
                  messages: [
                    {
                      role: "system",
                      content: `You are ${agentName}, ${agentRole}. ${welcomeMessage}`
                    }
                  ]
                },
                firstMessage: welcomeMessage,
                voice: voiceProvider === '11labs' ? {
                  provider: "11labs",
                  voiceId: voiceId.length === 20 ? voiceId : 'bIHbv24MWmeRgasZH58o'
                } : {
                  provider: "playht",
                  voiceId: voiceId.length !== 20 ? voiceId : "susan"
                },
                metadata: {
                  tenant_id: chatbotId
                }
              });
            }
          } catch (e) {
            console.error('[StyleFlo Widget] Vapi start error:', e);
            appendMessage('bot', 'Microphone access denied or voice connection failed.');
          }
        }
      });
    }

    // Form Submit Event Handler
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const messageText = inputField.value.trim();
      if (!messageText) return;

      // 1. Add user message
      appendMessage('user', messageText);
      inputField.value = '';

      // 2. Add typing indicator
      const typingIndicator = showTypingIndicator();

      // 3. Initiate fetch streaming call
      try {
        const response = await fetch(`${apiHost}/api/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: messageText,
            chatbotId: chatbotId,
            sessionId: sessionId,
            clientName: storedName,
          }),
        });

        // Remove typing indicator once stream starts or fails
        typingIndicator.remove();

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          appendMessage('bot', 'Sorry, I am unable to process that message right now.');
          return;
        }

        // 4. Create bot response container
        const botResponseContainer = appendMessage('bot', '');
        let rawText = '';

        // 5. Read stream chunks and update UI
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          rawText += chunk;
          
          let formattedText = rawText
            // Hide secret tool tags
            .replace(/\[CHECK_AVAILABILITY:[\s\S]*?(?:\]|$)/g, '')
            .replace(/\[BOOK_MEETING:[\s\S]*?(?:\]|$)/g, '')
            .replace(/\[LEAD_CAPTURED:[\s\S]*?(?:\]|$)/g, '')
            .replace(/\[LOOKUP_APPOINTMENTS:[\s\S]*?(?:\]|$)/g, '')
            .replace(/\[TIME_SLOTS:[\s\S]*?(?:\}\]|$)/g, '')
            // Replace bold **text**
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Replace markdown links with formatted inline links
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" class="font-semibold text-indigo-600 hover:underline" style="color: ${primaryColor}; text-decoration: underline;">$1</a>')
            // Convert newlines to <br>
            .replace(/\n/g, '<br/>');

          botResponseContainer.innerHTML = formattedText;
          scrollToBottom();
        }

        // 6. After streaming completes, look for product links and append rich product cards
        const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
        let match;
        const productUrls: string[] = [];
        
        while ((match = linkRegex.exec(rawText)) !== null) {
          const url = match[2];
          const isProductUrl = url.includes('/products/') || url.includes('/product/') || url.includes('/shop/');
          if (isProductUrl && !productUrls.includes(url)) {
            productUrls.push(url);
          }
        }

        for (const url of productUrls) {
          // Render a skeleton loading card first
          const cardContainer = document.createElement('div');
          cardContainer.className = 'my-2 p-3 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-3 styleflo-animate-pulse';
          cardContainer.innerHTML = `
            <div class="w-12 h-12 bg-gray-200 rounded-xl flex-shrink-0" style="width: 48px; height: 48px;"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3 bg-gray-200 rounded w-3/4" style="height: 12px;"></div>
              <div class="h-2.5 bg-gray-200 rounded w-1/2" style="height: 10px;"></div>
            </div>
          `;
          
          // Insert the card container inline, directly following the anchor link mention
          const anchor = botResponseContainer.querySelector(`a[href="${url}"]`);
          if (anchor) {
            anchor.parentNode?.insertBefore(cardContainer, anchor.nextSibling);
          } else {
            botResponseContainer.appendChild(cardContainer);
          }
          scrollToBottom();

          try {
            const res = await fetch(`${apiHost}/api/products/metadata?url=${encodeURIComponent(url)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.success && data.metadata) {
                const meta = data.metadata;
                cardContainer.className = 'my-2 p-3 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-3 transition-all duration-300 hover:shadow-md';
                cardContainer.innerHTML = `
                  ${meta.image_url ? `
                    <img src="${meta.image_url}" alt="${meta.title || 'Product Image'}" class="w-12 h-12 object-cover rounded-xl border border-gray-100 bg-white flex-shrink-0" style="width: 48px; height: 48px;" />
                  ` : `
                    <div class="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 border border-gray-100 text-gray-400" style="width: 48px; height: 48px;">🛍️</div>
                  `}
                  <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-xs text-gray-800 truncate leading-tight" style="margin: 0; font-size: 12px;">${meta.title || 'Product Details'}</h4>
                    <p class="text-[10px] text-gray-400 mt-1 leading-normal capitalize" style="margin: 4px 0 0 0; font-size: 10px;">${meta.site_name || 'Store'}</p>
                    ${meta.price ? `
                      <p class="text-xs font-semibold text-gray-900 mt-1" style="margin: 4px 0 0 0; font-size: 11px; font-weight: 600;">${meta.currency === 'GBP' || meta.currency === '£' ? '£' : (meta.currency || '$')}${meta.price}</p>
                    ` : ''}
                  </div>
                  <a href="${url}" target="_blank" class="px-3.5 py-1.5 rounded-xl text-[10px] font-bold text-white transition-opacity flex-shrink-0" style="background-color: ${primaryColor}; font-size: 10px; font-weight: 700; padding: 6px 12px; border-radius: 8px; text-decoration: none; display: inline-block;">
                    Buy Now
                  </a>
                `;
              } else {
                cardContainer.remove();
              }
            } else {
              cardContainer.remove();
            }
          } catch (err) {
            console.warn('[Widget] Failed to fetch product card details:', err);
            cardContainer.remove();
          }
          scrollToBottom();
        }

        // 7. Parse [TIME_SLOTS: ...] if present
        const timeSlotRegex = /\[TIME_SLOTS:\s*({.*?})\]/;
        const timeSlotMatch = rawText.match(timeSlotRegex);
        if (timeSlotMatch && timeSlotMatch[1]) {
          try {
            const timeSlotsJSON = JSON.parse(timeSlotMatch[1]);
            const gridContainer = document.createElement('div');
            gridContainer.className = 'mt-3 w-full';
            
            let gridHtml = '';
            for (const [dateStr, times] of Object.entries(timeSlotsJSON)) {
              if (Array.isArray(times) && times.length > 0) {
                const d = new Date(dateStr);
                const displayDate = isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
                
                gridHtml += `
                  <div class="mb-3">
                    <div class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 ml-1">${displayDate}</div>
                    <div class="flex flex-wrap gap-2">
                      ${times.map(t => `<button type="button" class="styleflo-time-btn px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 hover:text-white transition-colors bg-white shadow-sm" data-time="${t}" data-date="${dateStr}">${t}</button>`).join('')}
                    </div>
                  </div>
                `;
              }
            }
            gridContainer.innerHTML = gridHtml;
            botResponseContainer.appendChild(gridContainer);
            
            // Add event listeners to the generated buttons
            const btns = gridContainer.querySelectorAll('.styleflo-time-btn');
            btns.forEach((btn: Element) => {
              const htmlBtn = btn as HTMLButtonElement;
              htmlBtn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const date = target.getAttribute('data-date');
                const time = target.getAttribute('data-time');
                
                target.style.backgroundColor = primaryColor;
                target.style.color = 'white';
                target.style.borderColor = primaryColor;
                
                inputField.value = `I would like to book ${date} at ${time}`;
                chatForm.dispatchEvent(new Event('submit'));
              });
              
              htmlBtn.addEventListener('mouseenter', () => {
                htmlBtn.style.backgroundColor = primaryColor;
                htmlBtn.style.borderColor = primaryColor;
                htmlBtn.style.color = 'white';
              });
              htmlBtn.addEventListener('mouseleave', () => {
                htmlBtn.style.backgroundColor = 'white';
                htmlBtn.style.borderColor = '#e5e7eb';
                htmlBtn.style.color = '#374151';
              });
            });
            
            scrollToBottom();
          } catch (e) {
            console.error('[StyleFlo Widget] Failed to parse TIME_SLOTS', e);
          }
        }

      } catch (err: any) {
        console.error('[StyleFlo Widget] Chat Stream fetch error:', err);
        typingIndicator.remove();
        appendMessage('bot', 'An error occurred. Please try again or refresh the page.');
      }
    });
  }

  // Begin execution
  fetchConfig();
})();
