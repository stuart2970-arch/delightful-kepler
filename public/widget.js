"use strict";(()=>{(function(){let B=document.currentScript;if(!B){console.error("[StyleFlo Widget] Current script context not found.");return}let w=B.getAttribute("data-bot-id");if(!w){console.error('[StyleFlo Widget] Missing required "data-bot-id" attribute on script tag.');return}let m=new URL(B.src).origin,O=`styleflo_session_${w}`,C=localStorage.getItem(O);C||(C="session_"+crypto.randomUUID(),localStorage.setItem(O,C));let y=document.createElement("div");y.id="styleflo-chat-widget",y.style.position="fixed",y.style.bottom="0",y.style.right="0",y.style.zIndex="999999",document.body.appendChild(y);let a=y.attachShadow({mode:"open"}),N=document.createElement("link");N.rel="stylesheet",N.href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css",a.appendChild(N);let P=document.createElement("style");P.textContent=`
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
  `,a.appendChild(P);let E=document.createElement("div");E.className="font-sans",a.appendChild(E);let l="#4F46E5",U="AI Assistant",R="AI Assistant",W="AI Support Agent",v="/avatars/avatar1.png",q="Hello! How can I help you today?",j='<span style="opacity: 0.6; font-size: 11px;">\u26A1 Powered by <strong>StyleFlo</strong></span>';async function Y(){try{let c=await fetch(`${m}/api/chatbots/${w}`);if(c.ok){let t=await c.json();t.name&&(U=t.name),t.primaryColor&&(l=t.primaryColor),R=t.agentName||U,W=t.agentRole||"AI Support Agent",v=t.agentAvatarUrl||"/avatars/avatar1.png",q=t.welcomeMessage||"Hello! How can I help you today?",j=t.brandingHtml||j}}catch(c){console.warn("[StyleFlo Widget] Failed to fetch chatbot config, using defaults:",c)}V()}function V(){let c=document.createElement("button");c.className="fixed bottom-5 right-5 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 focus:outline-none z-50",c.style.backgroundColor=l,c.innerHTML=`
      <!-- Chat Icon -->
      <svg id="styleflo-icon-chat" class="w-6 h-6 text-white transition-all duration-300 transform scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
      <!-- Close Icon (Initially hidden) -->
      <svg id="styleflo-icon-close" class="w-6 h-6 text-white absolute transition-all duration-300 transform scale-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `,E.appendChild(c);let t=document.createElement("div");t.className="fixed z-50 flex flex-col bg-white overflow-hidden transition-all duration-300 transform scale-90 opacity-0 pointer-events-none origin-bottom-right bottom-20 right-5 rounded-2xl border border-gray-100 shadow-2xl styleflo-chat-window",t.innerHTML=`
      <!-- Header -->
      <div class="p-4 text-white flex items-center justify-between shadow-md shrink-0 z-10" style="background-color: ${l};">
        <div class="flex items-center gap-3">
          <img src="${m}${v}" alt="Agent Avatar" class="w-10 h-10 rounded-full border border-white/20 bg-white/10 object-cover" />
          <div>
            <h3 class="font-bold styleflo-text-17 leading-tight">${R}</h3>
            <p class="styleflo-text-11 opacity-75 mt-0.5">${W}</p>
          </div>
        </div>
        <button id="styleflo-close-btn" class="text-white opacity-80 hover:opacity-100 focus:outline-none transition-opacity">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <!-- Onboarding Area -->
      <div id="styleflo-onboarding" class="flex-1 flex flex-col items-center justify-center p-6 bg-gray-50 text-center" style="display: none;">
        <div class="w-16 h-16 rounded-full flex items-center justify-center mb-4 text-white shadow-lg" style="background-color: ${l};">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h4 class="font-bold text-gray-800 text-lg mb-2">Welcome!</h4>
        <p class="text-gray-500 text-sm mb-6">Please enter your name so we know who we are chatting with.</p>
        <form id="styleflo-onboarding-form" class="w-full">
          <input type="text" id="styleflo-onboarding-name" required placeholder="Name" class="w-full px-4 py-3 mb-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all" style="--tw-ring-color: ${l};" />
          <button type="submit" class="w-full py-3 rounded-xl text-white font-semibold shadow-md transition-opacity hover:opacity-95" style="background-color: ${l};">Start Chatting</button>
        </form>
      </div>

      <!-- Messages Area -->
      <div id="styleflo-messages" class="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 space-y-4 bg-gray-50 styleflo-scrollbar">
        <!-- Welcome Message -->
        <div class="flex items-start gap-2.5 w-full">
          <img src="${m}${v}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0" />
          <div class="p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 styleflo-mw-75 shadow-sm leading-relaxed w-full">
            ${q}
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <form id="styleflo-chat-form" class="p-3 bg-white border-t border-gray-100 flex items-center gap-2 shrink-0 z-10">
        <input 
          id="styleflo-input" 
          type="text" 
          placeholder="Type your message..." 
          class="flex-1 px-3 py-2 styleflo-text-15 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all"
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

      <!-- Branding Footer -->
      <a href="${m}/api/track?ref=${w}&source=${encodeURIComponent(window.location.hostname)}" target="_blank" rel="noopener noreferrer" class="w-full bg-gray-50 text-center py-1.5 border-t border-gray-100 block hover:bg-gray-100 transition-colors cursor-pointer text-gray-500 flex items-center justify-center">
        ${j}
      </a>
    `,E.appendChild(t);let b=a.getElementById("styleflo-messages"),$=a.getElementById("styleflo-chat-form"),k=a.getElementById("styleflo-input"),Q=a.getElementById("styleflo-close-btn"),L=a.getElementById("styleflo-icon-chat"),I=a.getElementById("styleflo-icon-close"),K=a.getElementById("styleflo-onboarding"),X=a.getElementById("styleflo-onboarding-form"),Z=a.getElementById("styleflo-onboarding-name"),D=localStorage.getItem("styleflo-client-name");D||(b.style.display="none",$.style.display="none",K.style.display="flex"),X.addEventListener("submit",r=>{r.preventDefault();let d=Z.value.trim();d&&(localStorage.setItem("styleflo-client-name",d),D=d,K.style.display="none",b.style.display="block",$.style.display="flex",k.focus())});let z=!1;function G(){z=!z,z?(t.classList.remove("scale-90","opacity-0","pointer-events-none"),t.classList.add("scale-100","opacity-100","pointer-events-auto"),L.classList.remove("scale-100"),L.classList.add("scale-0"),I.classList.remove("scale-0"),I.classList.add("scale-100"),k.focus()):(t.classList.remove("scale-100","opacity-100","pointer-events-auto"),t.classList.add("scale-90","opacity-0","pointer-events-none"),L.classList.remove("scale-0"),L.classList.add("scale-100"),I.classList.remove("scale-100"),I.classList.add("scale-0"))}c.addEventListener("click",G),Q.addEventListener("click",G);function x(){b.scrollTop=b.scrollHeight}function T(r,d=""){let g=document.createElement("div");if(g.className=r==="user"?"flex justify-end w-full":"flex items-start gap-2.5 w-full",r==="bot"){let i=document.createElement("img");i.src=`${m}${v}`,i.alt="Agent Avatar",i.className="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0",g.appendChild(i)}let n=document.createElement("div");if(n.className=r==="user"?"p-3 text-white rounded-2xl rounded-tr-none styleflo-text-15 styleflo-mw-85 shadow-sm leading-relaxed w-full":"p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 shadow-sm leading-relaxed w-full",r==="user")n.style.backgroundColor=l,n.textContent=d,g.appendChild(n);else{let i=document.createElement("div");i.className="flex flex-col min-w-0 styleflo-mw-75",n.textContent=d,i.appendChild(n),g.appendChild(i)}return b.appendChild(g),x(),n}function ee(){let r=document.createElement("div");return r.id="styleflo-typing-indicator",r.className="flex items-start gap-2.5",r.innerHTML=`
        <img src="${m}${v}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0" />
        <div class="flex items-center gap-1.5 p-3.5 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
        </div>
      `,b.appendChild(r),x(),r}$.addEventListener("submit",async r=>{r.preventDefault();let d=k.value.trim();if(!d)return;T("user",d),k.value="";let g=ee();try{let n=await fetch(`${m}/api/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:d,chatbotId:w,sessionId:C,clientName:D})});if(g.remove(),!n.ok)throw new Error(`Server returned HTTP ${n.status}`);let i=n.body?.getReader(),te=new TextDecoder;if(!i){T("bot","Sorry, I am unable to process that message right now.");return}let M=T("bot",""),S="";for(;;){let{done:s,value:o}=await i.read();if(s)break;let u=te.decode(o,{stream:!0});S+=u;let f=S.replace(/\[CHECK_AVAILABILITY:[\s\S]*?(?:\]|$)/g,"").replace(/\[BOOK_MEETING:[\s\S]*?(?:\]|$)/g,"").replace(/\[LEAD_CAPTURED:[\s\S]*?(?:\]|$)/g,"").replace(/\[LOOKUP_APPOINTMENTS:[\s\S]*?(?:\]|$)/g,"").replace(/\[TIME_SLOTS:[\s\S]*?(?:\}\]|$)/g,"").replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" class="font-semibold text-indigo-600 hover:underline" style="color: ${primaryColor}; text-decoration: underline;">$1</a>').replace(/\n/g,"<br/>");M.innerHTML=f,x()}let oe=/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,J,F=[];for(;(J=oe.exec(S))!==null;){let s=J[2];(s.includes("/products/")||s.includes("/product/")||s.includes("/shop/"))&&!F.includes(s)&&F.push(s)}for(let s of F){let o=document.createElement("div");o.className="my-2 p-3 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-3 styleflo-animate-pulse",o.innerHTML=`
            <div class="w-12 h-12 bg-gray-200 rounded-xl flex-shrink-0" style="width: 48px; height: 48px;"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3 bg-gray-200 rounded w-3/4" style="height: 12px;"></div>
              <div class="h-2.5 bg-gray-200 rounded w-1/2" style="height: 10px;"></div>
            </div>
          `;let u=M.querySelector(`a[href="${s}"]`);u?u.parentNode?.insertBefore(o,u.nextSibling):M.appendChild(o),x();try{let f=await fetch(`${m}/api/products/metadata?url=${encodeURIComponent(s)}`);if(f.ok){let p=await f.json();if(p.success&&p.metadata){let e=p.metadata;o.className="my-2 p-3 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-3 transition-all duration-300 hover:shadow-md",o.innerHTML=`
                  ${e.image_url?`
                    <img src="${e.image_url}" alt="${e.title||"Product Image"}" class="w-12 h-12 object-cover rounded-xl border border-gray-100 bg-white flex-shrink-0" style="width: 48px; height: 48px;" />
                  `:`
                    <div class="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 border border-gray-100 text-gray-400" style="width: 48px; height: 48px;">\u{1F6CD}\uFE0F</div>
                  `}
                  <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-xs text-gray-800 truncate leading-tight" style="margin: 0; font-size: 12px;">${e.title||"Product Details"}</h4>
                    <p class="text-[10px] text-gray-400 mt-1 leading-normal capitalize" style="margin: 4px 0 0 0; font-size: 10px;">${e.site_name||"Store"}</p>
                    ${e.price?`
                      <p class="text-xs font-semibold text-gray-900 mt-1" style="margin: 4px 0 0 0; font-size: 11px; font-weight: 600;">${e.currency==="GBP"||e.currency==="\xA3"?"\xA3":e.currency||"$"}${e.price}</p>
                    `:""}
                  </div>
                  <a href="${s}" target="_blank" class="px-3.5 py-1.5 rounded-xl text-[10px] font-bold text-white transition-opacity flex-shrink-0" style="background-color: ${l}; font-size: 10px; font-weight: 700; padding: 6px 12px; border-radius: 8px; text-decoration: none; display: inline-block;">
                    Buy Now
                  </a>
                `}else o.remove()}else o.remove()}catch(f){console.warn("[Widget] Failed to fetch product card details:",f),o.remove()}x()}let se=/\[TIME_SLOTS:\s*({.*?})\]/,_=S.match(se);if(_&&_[1])try{let s=JSON.parse(_[1]),o=document.createElement("div");o.className="mt-3 w-full";let u="";for(let[p,e]of Object.entries(s))if(Array.isArray(e)&&e.length>0){let A=new Date(p),h=isNaN(A.getTime())?p:A.toLocaleDateString("en-GB",{weekday:"short",month:"short",day:"numeric"});u+=`
                  <div class="mb-3">
                    <div class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 ml-1">${h}</div>
                    <div class="flex flex-wrap gap-2">
                      ${e.map(H=>`<button type="button" class="styleflo-time-btn px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 hover:text-white transition-colors bg-white shadow-sm" data-time="${H}" data-date="${p}">${H}</button>`).join("")}
                    </div>
                  </div>
                `}o.innerHTML=u,M.appendChild(o),o.querySelectorAll(".styleflo-time-btn").forEach(p=>{let e=p;e.addEventListener("click",A=>{let h=A.currentTarget,H=h.getAttribute("data-date"),le=h.getAttribute("data-time");h.style.backgroundColor=l,h.style.color="white",h.style.borderColor=l,k.value=`I would like to book ${H} at ${le}`,$.dispatchEvent(new Event("submit"))}),e.addEventListener("mouseenter",()=>{e.style.backgroundColor=l,e.style.borderColor=l,e.style.color="white"}),e.addEventListener("mouseleave",()=>{e.style.backgroundColor="white",e.style.borderColor="#e5e7eb",e.style.color="#374151"})}),x()}catch(s){console.error("[StyleFlo Widget] Failed to parse TIME_SLOTS",s)}}catch(n){console.error("[StyleFlo Widget] Chat Stream fetch error:",n),g.remove(),T("bot","An error occurred. Please try again or refresh the page.")}})}Y()})();})();
