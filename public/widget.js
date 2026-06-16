"use strict";(()=>{(function(){let y=document.currentScript;if(!y){console.error("[StyleFlo Widget] Current script context not found.");return}let c=y.getAttribute("data-bot-id");if(!c){console.error('[StyleFlo Widget] Missing required "data-bot-id" attribute on script tag.');return}let x=new URL(y.src).origin,k=`styleflo_session_${c}`,d=localStorage.getItem(k);d||(d="session_"+crypto.randomUUID(),localStorage.setItem(k,d));let r=document.createElement("div");r.id="styleflo-chat-widget",r.style.position="fixed",r.style.bottom="0",r.style.right="0",r.style.zIndex="999999",document.body.appendChild(r);let n=r.attachShadow({mode:"open"}),g=document.createElement("link");g.rel="stylesheet",g.href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css",n.appendChild(g);let C=document.createElement("style");C.textContent=`
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
  `,n.appendChild(C);let u=document.createElement("div");u.className="font-sans",n.appendChild(u);let l="#4F46E5",L="AI Assistant";async function M(){try{let s=await fetch(`${x}/api/chatbots/${c}`);if(s.ok){let e=await s.json();e.name&&(L=e.name),e.primaryColor&&(l=e.primaryColor)}}catch(s){console.warn("[StyleFlo Widget] Failed to fetch chatbot config, using defaults:",s)}T()}function T(){let s=document.createElement("button");s.className="fixed bottom-5 right-5 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 focus:outline-none z-50",s.style.backgroundColor=l,s.innerHTML=`
      <!-- Chat Icon -->
      <svg id="styleflo-icon-chat" class="w-6 h-6 text-white transition-all duration-300 transform scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
      <!-- Close Icon (Initially hidden) -->
      <svg id="styleflo-icon-close" class="w-6 h-6 text-white absolute transition-all duration-300 transform scale-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `,u.appendChild(s);let e=document.createElement("div");e.className="fixed bottom-24 right-5 w-[380px] h-[550px] max-h-[calc(100vh-120px)] max-w-[calc(100vw-40px)] flex flex-col bg-white border border-gray-100 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 transform scale-90 opacity-0 pointer-events-none origin-bottom-right z-50",e.innerHTML=`
      <!-- Header -->
      <div class="p-4 text-white flex items-center justify-between shadow-md" style="background-color: ${l};">
        <div>
          <h3 class="font-bold text-base leading-tight">${L}</h3>
          <p class="text-xs opacity-75 mt-0.5">Powered by StyleFlo</p>
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
          <div class="p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none text-sm max-w-[85%] shadow-sm leading-relaxed">
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
          style="--tw-ring-color: ${l};"
          autocomplete="off"
        />
        <button 
          type="submit" 
          class="p-2 rounded-xl text-white hover:opacity-95 focus:outline-none transition-opacity" 
          style="background-color: ${l};"
        >
          <svg class="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
          </svg>
        </button>
      </form>
    `,u.appendChild(e);let p=n.getElementById("styleflo-messages"),H=n.getElementById("styleflo-chat-form"),b=n.getElementById("styleflo-input"),S=n.getElementById("styleflo-close-btn"),m=n.getElementById("styleflo-icon-chat"),h=n.getElementById("styleflo-icon-close"),w=!1;function E(){w=!w,w?(e.classList.remove("scale-90","opacity-0","pointer-events-none"),e.classList.add("scale-100","opacity-100","pointer-events-auto"),m.classList.remove("scale-100"),m.classList.add("scale-0"),h.classList.remove("scale-0"),h.classList.add("scale-100"),b.focus()):(e.classList.remove("scale-100","opacity-100","pointer-events-auto"),e.classList.add("scale-90","opacity-0","pointer-events-none"),m.classList.remove("scale-0"),m.classList.add("scale-100"),h.classList.remove("scale-100"),h.classList.add("scale-0"))}s.addEventListener("click",E),S.addEventListener("click",E);function v(){p.scrollTop=p.scrollHeight}function f(t,i=""){let a=document.createElement("div");a.className=t==="user"?"flex justify-end":"flex items-start gap-2.5";let o=document.createElement("div");return o.className=t==="user"?"p-3 text-white rounded-2xl rounded-tr-none text-sm max-w-[85%] shadow-sm leading-relaxed":"p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none text-sm max-w-[85%] shadow-sm leading-relaxed",t==="user"&&(o.style.backgroundColor=l),o.textContent=i,a.appendChild(o),p.appendChild(a),v(),o}function B(){let t=document.createElement("div");return t.id="styleflo-typing-indicator",t.className="flex items-start gap-2.5",t.innerHTML=`
        <div class="flex items-center gap-1.5 p-3.5 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
        </div>
      `,p.appendChild(t),v(),t}H.addEventListener("submit",async t=>{t.preventDefault();let i=b.value.trim();if(!i)return;f("user",i),b.value="";let a=B();try{let o=await fetch(`${x}/api/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:i,chatbotId:c,sessionId:d})});if(a.remove(),!o.ok)throw new Error(`Server returned HTTP ${o.status}`);let I=o.body?.getReader(),D=new TextDecoder;if(!I){f("bot","Sorry, I am unable to process that message right now.");return}let F=f("bot","");for(;;){let{done:j,value:$}=await I.read();if(j)break;let A=D.decode($,{stream:!0});F.textContent+=A,v()}}catch(o){console.error("[StyleFlo Widget] Chat Stream fetch error:",o),a.remove(),f("bot","An error occurred. Please try again or refresh the page.")}})}M()})();})();
