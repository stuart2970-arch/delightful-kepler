"use strict";(()=>{(function(){let v=document.currentScript;if(!v){console.error("[StyleFlo Widget] Current script context not found.");return}let p=v.getAttribute("data-bot-id");if(!p){console.error('[StyleFlo Widget] Missing required "data-bot-id" attribute on script tag.');return}let i=new URL(v.src).origin,L=`styleflo_session_${p}`,m=localStorage.getItem(L);m||(m="session_"+crypto.randomUUID(),localStorage.setItem(L,m));let n=document.createElement("div");n.id="styleflo-chat-widget",n.style.position="fixed",n.style.bottom="0",n.style.right="0",n.style.zIndex="999999",document.body.appendChild(n);let r=n.attachShadow({mode:"open"}),w=document.createElement("link");w.rel="stylesheet",w.href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css",r.appendChild(w);let E=document.createElement("style");E.textContent=`
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
  `,r.appendChild(E);let h=document.createElement("div");h.className="font-sans",r.appendChild(h);let c="#4F46E5",I="AI Assistant",M="AI Assistant",A="AI Support Agent",d="/avatars/avatar1.png";async function H(){try{let s=await fetch(`${i}/api/chatbots/${p}`);if(s.ok){let e=await s.json();e.name&&(I=e.name),e.primaryColor&&(c=e.primaryColor),M=e.agentName||I,A=e.agentRole||"AI Support Agent",d=e.agentAvatarUrl||"/avatars/avatar1.png"}}catch(s){console.warn("[StyleFlo Widget] Failed to fetch chatbot config, using defaults:",s)}$()}function $(){let s=document.createElement("button");s.className="fixed bottom-5 right-5 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 focus:outline-none z-50",s.style.backgroundColor=c,s.innerHTML=`
      <!-- Chat Icon -->
      <svg id="styleflo-icon-chat" class="w-6 h-6 text-white transition-all duration-300 transform scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
      <!-- Close Icon (Initially hidden) -->
      <svg id="styleflo-icon-close" class="w-6 h-6 text-white absolute transition-all duration-300 transform scale-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `,h.appendChild(s);let e=document.createElement("div");e.className="fixed bottom-24 right-5 w-[380px] h-[550px] max-h-[calc(100vh-120px)] max-w-[calc(100vw-40px)] flex flex-col bg-white border border-gray-100 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 transform scale-90 opacity-0 pointer-events-none origin-bottom-right z-50",e.innerHTML=`
      <!-- Header -->
      <div class="p-4 text-white flex items-center justify-between shadow-md" style="background-color: ${c};">
        <div class="flex items-center gap-3">
          <img src="${i}${d}" alt="Agent Avatar" class="w-10 h-10 rounded-full border border-white/20 bg-white/10 object-cover" />
          <div>
            <h3 class="font-bold text-base leading-tight">${M}</h3>
            <p class="text-[10px] opacity-75 mt-0.5">${A}</p>
          </div>
        </div>
        <button id="styleflo-close-btn" class="text-white opacity-80 hover:opacity-100 focus:outline-none transition-opacity">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <!-- Messages Area -->
      <div id="styleflo-messages" class="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 styleflo-scrollbar">
        <!-- Welcome Message -->
        <div class="flex items-start gap-2.5">
          <img src="${i}${d}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100" />
          <div class="p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none text-sm max-w-[75%] shadow-sm leading-relaxed">
            Hello! How can I help you today?
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <form id="styleflo-chat-form" class="p-3 bg-white border-t border-gray-100 flex items-center gap-2">
        <input 
          id="styleflo-input" 
          type="text" 
          placeholder="Type your message..." 
          class="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all"
          style="--tw-ring-color: ${c};"
          autocomplete="off"
        />
        <button 
          type="submit" 
          class="p-2 rounded-xl text-white hover:opacity-95 focus:outline-none transition-opacity" 
          style="background-color: ${c};"
        >
          <svg class="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
          </svg>
        </button>
      </form>
    `,h.appendChild(e);let g=r.getElementById("styleflo-messages"),S=r.getElementById("styleflo-chat-form"),x=r.getElementById("styleflo-input"),B=r.getElementById("styleflo-close-btn"),f=r.getElementById("styleflo-icon-chat"),y=r.getElementById("styleflo-icon-close"),k=!1;function T(){k=!k,k?(e.classList.remove("scale-90","opacity-0","pointer-events-none"),e.classList.add("scale-100","opacity-100","pointer-events-auto"),f.classList.remove("scale-100"),f.classList.add("scale-0"),y.classList.remove("scale-0"),y.classList.add("scale-100"),x.focus()):(e.classList.remove("scale-100","opacity-100","pointer-events-auto"),e.classList.add("scale-90","opacity-0","pointer-events-none"),f.classList.remove("scale-0"),f.classList.add("scale-100"),y.classList.remove("scale-100"),y.classList.add("scale-0"))}s.addEventListener("click",T),B.addEventListener("click",T);function C(){g.scrollTop=g.scrollHeight}function b(t,u=""){let a=document.createElement("div");if(a.className=t==="user"?"flex justify-end":"flex items-start gap-2.5",t==="bot"){let l=document.createElement("img");l.src=`${i}${d}`,l.alt="Agent Avatar",l.className="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0",a.appendChild(l)}let o=document.createElement("div");return o.className=t==="user"?"p-3 text-white rounded-2xl rounded-tr-none text-sm max-w-[85%] shadow-sm leading-relaxed":"p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none text-sm max-w-[75%] shadow-sm leading-relaxed",t==="user"&&(o.style.backgroundColor=c),o.textContent=u,a.appendChild(o),g.appendChild(a),C(),o}function j(){let t=document.createElement("div");return t.id="styleflo-typing-indicator",t.className="flex items-start gap-2.5",t.innerHTML=`
        <img src="${i}${d}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0" />
        <div class="flex items-center gap-1.5 p-3.5 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
        </div>
      `,g.appendChild(t),C(),t}S.addEventListener("submit",async t=>{t.preventDefault();let u=x.value.trim();if(!u)return;b("user",u),x.value="";let a=j();try{let o=await fetch(`${i}/api/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:u,chatbotId:p,sessionId:m})});if(a.remove(),!o.ok)throw new Error(`Server returned HTTP ${o.status}`);let l=o.body?.getReader(),D=new TextDecoder;if(!l){b("bot","Sorry, I am unable to process that message right now.");return}let N=b("bot","");for(;;){let{done:F,value:U}=await l.read();if(F)break;let W=D.decode(U,{stream:!0});N.textContent+=W,C()}}catch(o){console.error("[StyleFlo Widget] Chat Stream fetch error:",o),a.remove(),b("bot","An error occurred. Please try again or refresh the page.")}})}H()})();})();
