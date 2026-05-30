(function(){const s=document.createElement("link").relList;if(s&&s.supports&&s.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))n(a);new MutationObserver(a=>{for(const r of a)if(r.type==="childList")for(const i of r.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&n(i)}).observe(document,{childList:!0,subtree:!0});function e(a){const r={};return a.integrity&&(r.integrity=a.integrity),a.referrerPolicy&&(r.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?r.credentials="include":a.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(a){if(a.ep)return;a.ep=!0;const r=e(a);fetch(a.href,r)}})();const W="polytracker_cache_",Y=300*1e3,z=[t=>`https://corsproxy.io/?${encodeURIComponent(t)}`,t=>`https://api.allorigins.win/raw?url=${encodeURIComponent(t)}`];async function V(t,s={},e=0){try{const n=await fetch(t,s);if(!n.ok)throw new Error(`HTTP error! Status: ${n.status}`);return await n.json()}catch(n){if(console.warn(`Direct fetch failed for ${t}:`,n.message),s.method&&s.method!=="GET")throw n;if(e<z.length){const a=z[e](t);console.log(`Attempting fetch via CORS proxy ${e+1}: ${a}`);try{const r=await fetch(a,s);if(!r.ok)throw new Error(`Proxy HTTP error! Status: ${r.status}`);return await r.json()}catch(r){return console.warn(`Proxy ${e+1} failed:`,r.message),V(t,s,e+1)}}throw new Error(`Failed to fetch ${t} directly and through all proxies.`)}}function G(t){try{const s=localStorage.getItem(W+t);if(!s)return null;const{data:e,timestamp:n,ttl:a}=JSON.parse(s);return Date.now()-n>a?(localStorage.removeItem(W+t),null):e}catch(s){return console.error("Error reading from localStorage cache",s),null}}function K(t,s,e=Y){try{localStorage.setItem(W+t,JSON.stringify({data:s,timestamp:Date.now(),ttl:e}))}catch(n){console.error("Error writing to localStorage cache",n),tt()}}function tt(){try{const t=Object.keys(localStorage);for(const s of t)s.startsWith(W)&&localStorage.removeItem(s)}catch(t){console.error("Failed to clear cache",t)}}async function j(t="all",s=100,e=!1){const n=`leaderboard_${t}_${s}`;if(!e){const i=G(n);if(i)return i}const a=`https://lb-api.polymarket.com/profit?window=${t}&limit=${s}`,r=await V(a);return K(n,r,600*1e3),r}async function J(t,s=!1){if(!t)return[];const e=t.toLowerCase().trim(),n=`positions_${e}`;if(!s){const r=G(n);if(r)return r}const a=`https://data-api.polymarket.com/positions?user=${e}`;try{const r=await V(a);return K(n,r,180*1e3),r}catch(r){return console.error(`Failed to fetch positions for ${t}:`,r),[]}}async function et(t,s,e=5){const n=[];let a=0;const r=t.length,i=[...t],c=async()=>{for(;i.length>0;){const o=i.shift();try{s&&s(a,r,o.pseudonym||o.name||o.proxyWallet);const p=await J(o.proxyWallet);n.push({trader:o,positions:p||[]})}catch(p){console.error(`Failed batch fetch for trader ${o.pseudonym}:`,p),n.push({trader:o,positions:[]})}finally{a++,s&&s(a,r,o.pseudonym||o.name||o.proxyWallet)}}},d=Math.min(e,r),l=[];for(let o=0;o<d;o++)l.push(c());return await Promise.all(l),n}function _(t,s=!1){if(t==null||isNaN(t))return"$0.00";const e=Math.abs(t);return s&&e>=1e3?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(t):new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(t)}function st(t,s=!0){if(t==null||isNaN(t))return"0.00%";const e=s?t:t*100;return`${e>=0?"+":""}${e.toFixed(2)}%`}function X(t){t||(t="unknown");let s=0;for(let d=0;d<t.length;d++)s=t.charCodeAt(d)+((s<<5)-s);const e=Math.abs(s%360),n=70+Math.abs(s>>8)%20,a=40+Math.abs(s>>16)%15,r=(e+120)%360;return`linear-gradient(135deg, hsl(${e}, ${n}%, ${a}%) 0%, hsl(${r}, ${n}%, ${a}%) 100%)`}function Z(t){return t?t.startsWith("0x")&&t.length>6?t.slice(2,4).toUpperCase():t.slice(0,2).toUpperCase():"??"}function R(t){return t?t.length<=10?t:`${t.slice(0,6)}...${t.slice(-4)}`:""}function U(t){return t==="table"?`
      <div class="skeleton-table">
        <div class="skeleton-row header"></div>
        ${Array(8).fill(0).map(()=>`
          <div class="skeleton-row">
            <div class="skeleton-cell rank"></div>
            <div class="skeleton-cell avatar"></div>
            <div class="skeleton-cell name"></div>
            <div class="skeleton-cell profit"></div>
            <div class="skeleton-cell bets"></div>
          </div>
        `).join("")}
      </div>
    `:t==="grid"?`
      <div class="skeleton-grid">
        ${Array(6).fill(0).map(()=>`
          <div class="skeleton-card">
            <div class="skeleton-title"></div>
            <div class="skeleton-meta"></div>
            <div class="skeleton-bar"></div>
            <div class="skeleton-footer"></div>
          </div>
        `).join("")}
      </div>
    `:t==="insights"?`
      <div class="skeleton-insights">
        <div class="skeleton-hero-card"></div>
        <div class="skeleton-grid">
          ${Array(4).fill(0).map(()=>`
            <div class="skeleton-card insight">
              <div class="skeleton-meta"></div>
              <div class="skeleton-title"></div>
              <div class="skeleton-bar"></div>
            </div>
          `).join("")}
        </div>
      </div>
    `:'<div class="skeleton"></div>'}const at={async render(t){t.innerHTML=`
      <div class="page-header animate-fade-in">
        <div>
          <h2 class="page-header__title">Leaderboard</h2>
          <p class="page-header__subtitle">Track the most profitable Polymarket wallets by timeframe</p>
        </div>
        <div class="stats-row" id="leaderboard-summary-stats">
          <!-- Populated dynamically -->
          <div class="stats-card skeleton-pulse" style="width: 140px; height: 60px;"></div>
          <div class="stats-card skeleton-pulse" style="width: 140px; height: 60px;"></div>
        </div>
      </div>

      <div class="control-bar animate-fade-in">
        <div class="search-box">
          <svg class="search-box__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" id="trader-search" placeholder="Search by name or wallet address..." class="search-box__input" />
        </div>
        <div class="filter-group">
          <div class="filter-tabs" id="window-filters">
            <button class="filter-tab window-btn" data-window="1d">Daily</button>
            <button class="filter-tab window-btn" data-window="7d">Weekly</button>
            <button class="filter-tab window-btn active" data-window="30d">Monthly</button>
            <button class="filter-tab window-btn" data-window="all">All Time</button>
          </div>
        </div>
      </div>

      <div class="table-container animate-fade-in" id="leaderboard-table-wrapper">
        ${U("table")}
      </div>
    `;const s=document.getElementById("trader-search"),e=document.getElementById("leaderboard-table-wrapper"),n=document.getElementById("leaderboard-summary-stats"),a=document.getElementById("window-filters");let r=[],i=[],c="30d";const d=async l=>{var o;e.innerHTML=U("table"),s.value="";try{r=await j(l,100),i=[...r];const p=r.reduce((g,y)=>g+(y.amount||0),0),u=p/(r.length||1);n.innerHTML=`
          <div class="stats-card">
            <span class="stats-card__label">Combined Profit</span>
            <span class="stats-card__value text-success">${_(p,!0)}</span>
          </div>
          <div class="stats-card">
            <span class="stats-card__label">Average Profit</span>
            <span class="stats-card__value text-success">${_(u,!0)}</span>
          </div>
          <div class="stats-card">
            <span class="stats-card__label">Total Traders</span>
            <span class="stats-card__value">${r.length}</span>
          </div>
        `,q(e,i)}catch(p){console.error(`Error loading leaderboard for ${l}:`,p),e.innerHTML=`
          <div class="error-state">
            <svg class="error-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h3 class="error-state__title">Failed to load leaderboard</h3>
            <p class="error-state__message">Polymarket servers are currently busy. Please try again in a few moments.</p>
            <button class="btn btn--primary" id="retry-leaderboard">Retry</button>
          </div>
        `,(o=document.getElementById("retry-leaderboard"))==null||o.addEventListener("click",()=>{d(l)})}};await d(c),a.querySelectorAll(".window-btn").forEach(l=>{l.addEventListener("click",async()=>{a.querySelectorAll(".window-btn").forEach(o=>o.classList.remove("active")),l.classList.add("active"),c=l.getAttribute("data-window"),await d(c)})}),s.addEventListener("input",l=>{const o=l.target.value.toLowerCase().trim();o?i=r.filter(p=>p.pseudonym&&p.pseudonym.toLowerCase().includes(o)||p.name&&p.name.toLowerCase().includes(o)||p.proxyWallet&&p.proxyWallet.toLowerCase().includes(o)):i=[...r],q(e,i)})}};function q(t,s){if(s.length===0){t.innerHTML=`
      <div class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <h3 class="empty-state__title">No traders found</h3>
        <p class="empty-state__message">Try searching for a different name or wallet address.</p>
      </div>
    `;return}t.innerHTML=`
    <table class="table">
      <thead>
        <tr>
          <th style="width: 80px;">Rank</th>
          <th>Trader</th>
          <th>Wallet Address</th>
          <th class="text-right">Total Profit</th>
          <th style="width: 140px;" class="text-center">Action</th>
        </tr>
      </thead>
      <tbody>
        ${s.map((a,r)=>{const i=r+1,c=a.pseudonym||a.name||`Trader #${i}`,d=a.proxyWallet,l=a.amount||0,o=X(d||c),p=Z(c),u=R(d);return`
            <tr class="table-row" data-wallet="${d}">
              <td>
                <span class="rank-badge ${i<=3?`rank-badge--${i}`:""}">${i}</span>
              </td>
              <td>
                <div class="trader-cell">
                  <div class="avatar" style="background: ${o}">
                    ${p}
                  </div>
                  <div class="trader-info">
                    <span class="trader-name">${c}</span>
                    ${a.bio?`<span class="trader-bio">${a.bio.slice(0,45)}${a.bio.length>45?"...":""}</span>`:""}
                  </div>
                </div>
              </td>
              <td>
                <div class="wallet-cell" onclick="event.stopPropagation()">
                  <code class="wallet-code">${u}</code>
                  <button class="copy-btn" data-clipboard="${d}" title="Copy full address">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="copy-icon">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              </td>
              <td class="text-right font-mono font-semibold text-success">
                ${_(l)}
              </td>
              <td class="text-center" onclick="event.stopPropagation()">
                <a href="#trader/${d}" class="btn btn--secondary btn--sm">
                  View Bets
                </a>
              </td>
            </tr>
          `}).join("")}
      </tbody>
    </table>
  `,t.querySelectorAll(".copy-btn").forEach(a=>{a.addEventListener("click",async r=>{const i=a.getAttribute("data-clipboard");try{await navigator.clipboard.writeText(i);const c=a.innerHTML;a.innerHTML=`
          <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" class="copy-icon">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        `,a.classList.add("copy-btn--copied"),setTimeout(()=>{a.innerHTML=c,a.classList.remove("copy-btn--copied")},1500)}catch(c){console.error("Failed to copy text: ",c)}})}),t.querySelectorAll(".table-row").forEach(a=>{a.addEventListener("click",()=>{const r=a.getAttribute("data-wallet");r&&(window.location.hash=`#trader/${r}`)})})}function I(t){if(!t)return!1;const s=new Date;s.setHours(0,0,0,0);const e=t.endDate?new Date(t.endDate):null,n=e&&e<s;return t.curPrice>.005&&t.curPrice<.995&&!t.redeemable&&!n}const rt={async render(t,s){if(!s){t.innerHTML='<div class="error-state"><p>No wallet address provided.</p></div>';return}const e=s.toLowerCase().trim();t.innerHTML=`
      <div class="animate-fade-in">
        <a href="#leaderboard" class="back-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="back-link__icon">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          Back to Leaderboard
        </a>
      </div>

      <!-- Trader Profile Header -->
      <div id="trader-profile-header" class="trader-profile animate-fade-in">
        <!-- Rendered after loading profile -->
        <div class="trader-profile__loading skeleton-pulse" style="height: 180px; width: 100%; border-radius: 12px; margin-bottom: 24px;"></div>
      </div>

      <!-- Trader Bets Summary and Controls -->
      <div class="bets-section animate-fade-in">
        <div class="bets-section__header">
          <h3 class="bets-section__title">Active & Historical Bets</h3>
          
          <div class="bets-controls">
            <div class="filter-tabs">
              <button class="filter-tab active font-semibold" data-filter="all">All Bets</button>
              <button class="filter-tab font-semibold" data-filter="active">Active Only</button>
              <button class="filter-tab font-semibold" data-filter="resolved">Resolved</button>
            </div>
            
            <div class="sort-select-wrapper">
              <select id="bets-sort" class="sort-select">
                <option value="size-desc">Size: High to Low</option>
                <option value="pnl-desc">PnL: High to Low</option>
                <option value="pnl-asc">PnL: Low to High</option>
                <option value="title-asc">Market Name: A-Z</option>
              </select>
            </div>
          </div>
        </div>

        <div id="trader-bets-grid" class="bets-grid">
          ${U("grid")}
        </div>
      </div>
    `;const n=document.getElementById("trader-profile-header"),a=document.getElementById("trader-bets-grid"),r=document.querySelectorAll(".filter-tab"),i=document.getElementById("bets-sort");let c=[],d=[],l="all",o="size-desc";try{let u=null,g=null;try{const v=await j("all",100),h=v.findIndex(m=>m.proxyWallet.toLowerCase()===e);h!==-1&&(u=v[h],g=h+1)}catch(v){console.warn("Could not check leaderboard for trader info:",v)}u||(u={proxyWallet:e,pseudonym:`Wallet ${R(e)}`,name:R(e),amount:0}),c=await J(e);const y=c.filter(I),k=c.filter(v=>!I(v)),$=y.reduce((v,h)=>v+(h.currentValue||h.initialValue||0),0),L=y.reduce((v,h)=>v+(h.cashPnl||0),0),b=u.pseudonym||u.name,w=X(e),C=Z(b),x=u.amount||0;n.innerHTML=`
        <div class="trader-profile__main">
          <div class="trader-profile__identity">
            <div class="avatar avatar--lg" style="background: ${w}">
              ${C}
            </div>
            <div class="trader-profile__meta">
              <div class="trader-profile__name-row">
                <h2 class="trader-profile__name">${b}</h2>
                ${g?`<span class="rank-badge rank-badge--hero">Rank #${g}</span>`:'<span class="rank-badge">Trader</span>'}
              </div>
              <p class="trader-profile__wallet font-mono">${e}</p>
              ${u.bio?`<p class="trader-profile__bio">${u.bio}</p>`:""}
            </div>
          </div>
          
          <div class="trader-profile__stats">
            <div class="trader-profile__stat-card">
              <span class="trader-profile__stat-label">Total Realized Profit</span>
              <span class="trader-profile__stat-value font-mono ${x>=0?"text-success":"text-danger"}">
                ${_(x)}
              </span>
            </div>
            <div class="trader-profile__stat-card">
              <span class="trader-profile__stat-label">Capital at Risk</span>
              <span class="trader-profile__stat-value font-mono">
                ${_($)}
              </span>
            </div>
            <div class="trader-profile__stat-card">
              <span class="trader-profile__stat-label">Open Position PnL</span>
              <span class="trader-profile__stat-value font-mono ${L>=0?"text-success":"text-danger"}">
                ${_(L)}
              </span>
            </div>
          </div>
        </div>
      `,p(),r.forEach(v=>{v.addEventListener("click",h=>{r.forEach(m=>m.classList.remove("active")),v.classList.add("active"),l=v.getAttribute("data-filter"),p()})}),i.addEventListener("change",v=>{o=v.target.value,p()})}catch(u){console.error("Error rendering trader detail:",u),a.innerHTML=`
        <div class="error-state">
          <svg class="error-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3 class="error-state__title">Failed to load trader data</h3>
          <p class="error-state__message">Polymarket servers are busy or the wallet address is invalid.</p>
        </div>
      `}function p(){l==="all"?d=[...c]:l==="active"?d=c.filter(I):l==="resolved"&&(d=c.filter(u=>!I(u))),d.sort((u,g)=>{if(o==="size-desc"){const y=u.initialValue||0;return(g.initialValue||0)-y}else{if(o==="pnl-desc")return(g.cashPnl||0)-(u.cashPnl||0);if(o==="pnl-asc")return(u.cashPnl||0)-(g.cashPnl||0);if(o==="title-asc")return(u.title||"").localeCompare(g.title||"")}return 0}),nt(a,d)}}};function nt(t,s){if(s.length===0){t.innerHTML=`
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <h3 class="empty-state__title">No positions found</h3>
        <p class="empty-state__message">This wallet doesn't have any bets in this category.</p>
      </div>
    `;return}t.innerHTML=s.map(e=>{const n=!I(e),a=e.initialValue||0,r=e.currentValue||0,i=e.cashPnl||0,c=e.percentPnl||0,d=e.curPrice!==void 0?e.curPrice:0,l=e.avgPrice||0,o=e.size||0,p=e.outcome||"Unknown",u=i>=0,g=n?"RESOLVED":"ACTIVE",y=n?"badge--resolved":"badge--active";let k="outcome-badge--neutral";p.toLowerCase()==="yes"?k="outcome-badge--yes":p.toLowerCase()==="no"&&(k="outcome-badge--no");const $=e.slug?`https://polymarket.com/market/${e.slug}`:`https://polymarket.com/event/${e.eventSlug||""}`;return`
      <div class="bet-card animate-scale-in">
        <div class="bet-card__header">
          <img src="${e.icon||'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%231a233a"><rect width="100" height="100"/><text y=".75em" font-size="60" x="15">📈</text></svg>'}" class="bet-card__icon" alt="Market Icon" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\' fill=\\'%231a233a\\'><rect width=\\'100\\' height=\\'100\\'/><text y=\\'.75em\\' font-size=\\'60\\' x=\\'15\\'>📈</text></svg>';" />
          <div class="bet-card__meta">
            <span class="badge ${y}">${g}</span>
            <span class="outcome-badge ${k}">${p}</span>
          </div>
        </div>
        
        <h4 class="bet-card__title" title="${e.title}">
          <a href="${$}" target="_blank" rel="noopener noreferrer">${e.title}</a>
        </h4>

        <div class="bet-card__price-tracker">
          <div class="bet-card__price-labels">
            <span>Avg Entry: <strong class="font-mono font-medium">${(l*100).toFixed(0)}¢</strong></span>
            <span>Current: <strong class="font-mono font-medium">${(d*100).toFixed(0)}¢</strong></span>
          </div>
          <div class="price-bar">
            <!-- Entry marker -->
            <div class="price-bar__marker price-bar__marker--entry" style="left: ${l*100}%" title="Avg Entry: ${(l*100).toFixed(0)}¢"></div>
            <!-- Current level -->
            <div class="price-bar__fill ${u?"price-bar__fill--profit":"price-bar__fill--loss"}" style="width: ${d*100}%"></div>
          </div>
        </div>

        <div class="bet-card__stats">
          <div class="bet-card__stat">
            <span class="bet-card__stat-label">Contracts Held</span>
            <span class="bet-card__stat-value font-mono">${new Intl.NumberFormat("en-US").format(o.toFixed(0))} shares</span>
            <span class="bet-card__stat-help">Number of tickets/bets bought</span>
          </div>
          <div class="bet-card__stat">
            <span class="bet-card__stat-label">Total Spent</span>
            <span class="bet-card__stat-value font-mono">${_(a)}</span>
            <span class="bet-card__stat-help">What they paid to enter bet</span>
          </div>
          <div class="bet-card__stat">
            <span class="bet-card__stat-label">Value Right Now</span>
            <span class="bet-card__stat-value font-mono">${_(r)}</span>
            <span class="bet-card__stat-help">What it's worth if sold now</span>
          </div>
          <div class="bet-card__stat">
            <span class="bet-card__stat-label">Net Profit / Loss</span>
            <span class="bet-card__stat-value font-mono font-semibold ${u?"text-success":"text-danger"}">
              ${_(i)} (${st(c)})
            </span>
            <span class="bet-card__stat-help">${u?"Current net profit":"Current net loss"}</span>
          </div>
        </div>

        <div class="bet-card__footer">
          <a href="${$}" target="_blank" rel="noopener noreferrer" class="bet-card__link">
            Trade on Polymarket
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bet-card__link-icon">
              <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
            </svg>
          </a>
        </div>
      </div>
    `}).join("")}const ot={async render(t){t.innerHTML=`
      <div class="page-header animate-fade-in">
        <div>
          <h2 class="page-header__title">Smart Money Insights</h2>
          <p class="page-header__subtitle">Aggregated consensus and capital deployment from top profit leaders</p>
        </div>
        <div class="filter-group">
          <div class="filter-tabs" id="insights-window-filters">
            <button class="filter-tab window-btn" data-window="1d">Daily</button>
            <button class="filter-tab window-btn" data-window="7d">Weekly</button>
            <button class="filter-tab window-btn active" data-window="30d">Monthly</button>
            <button class="filter-tab window-btn" data-window="all">All Time</button>
          </div>
        </div>
      </div>

      <!-- Loading overlay/status, initially shown -->
      <div id="insights-loader" class="insights-loader animate-fade-in">
        <div class="loader-card">
          <div class="loader-card__spinner"></div>
          <h3 class="loader-card__title" id="loader-card-title">Scanning Smart Money Wallets...</h3>
          <p class="loader-card__message" id="loader-status">Initializing scanner...</p>
          
          <div class="progress-bar-wrapper">
            <div class="progress-bar-fill" id="loader-progress" style="width: 0%"></div>
          </div>
          
          <div class="loader-stats">
            <div class="loader-stat">
              <span class="loader-stat__label">Wallets Scanned</span>
              <span class="loader-stat__value" id="loader-stat-scanned">0 / 100</span>
            </div>
            <div class="loader-stat">
              <span class="loader-stat__label">Active Bets Found</span>
              <span class="loader-stat__value" id="loader-stat-positions">0</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Insights Content, initially hidden -->
      <div id="insights-content" class="insights-content hidden animate-fade-in">
        <div class="control-bar insights-controls">
          <div class="filter-group">
            <label for="insights-threshold-select" class="control-label font-semibold">Min Participation:</label>
            <select id="insights-threshold-select" class="sort-select inline-select">
              <option value="2">2+ Traders</option>
              <option value="5" selected>5+ Traders</option>
              <option value="10">10+ Traders</option>
              <option value="15">15+ Traders</option>
            </select>
          </div>
          
          <div class="filter-group">
            <label for="insights-sort-select" class="control-label font-semibold">Sort By:</label>
            <select id="insights-sort-select" class="sort-select inline-select">
              <option value="participation-desc">Traders Count (Highest)</option>
              <option value="capital-desc">Capital Deployed (Highest)</option>
              <option value="consensus-desc">Consensus Strength (Highest)</option>
            </select>
          </div>
        </div>

        <div id="insights-cards-grid" class="insights-grid">
          <!-- Populated dynamically -->
        </div>
      </div>
    `;const s=document.getElementById("insights-loader"),e=document.getElementById("insights-content"),n=document.getElementById("loader-status"),a=document.getElementById("loader-progress"),r=document.getElementById("loader-stat-scanned"),i=document.getElementById("loader-stat-positions"),c=document.getElementById("insights-threshold-select"),d=document.getElementById("insights-sort-select"),l=document.getElementById("insights-cards-grid"),o=document.getElementById("insights-window-filters");let p=[],u=0,g="30d",y=!1;const k={"1d":"Daily Profit Leaders","7d":"Weekly Profit Leaders","30d":"Monthly Profit Leaders",all:"All-Time Profit Leaders"},$=async b=>{var w;if(!y){y=!0,o.style.pointerEvents="none",o.style.opacity="0.6",s.classList.remove("hidden"),e.classList.add("hidden"),u=0,a.style.width="0%",n.textContent=`Fetching ${k[b]}...`,r.textContent="0 / 100",i.textContent="0",document.getElementById("loader-card-title").textContent=`Scanning ${k[b]}...`;try{const C=await j(b,100),x=await et(C,(h,m,P)=>{const T=Math.round(h/m*100);a.style.width=`${T}%`,n.textContent=`Scanning wallet for ${P}...`,r.textContent=`${h} / ${m}`,i.textContent=u},6);n.textContent="Aggregating active bets...";const v=new Map;for(const h of x){const{trader:m,positions:P}=h,T=m.pseudonym||m.name||m.proxyWallet;for(const f of P){const A=new Date;A.setHours(0,0,0,0);const M=f.endDate?new Date(f.endDate):null,D=M&&M<A;if(f.curPrice<=.005||f.curPrice>=.995||f.redeemable||D)continue;u++;const S=f.conditionId;if(!S)continue;v.has(S)||v.set(S,{conditionId:S,title:f.title||"Unknown Market",slug:f.slug,eventSlug:f.eventSlug,icon:f.icon,tradersCount:0,totalCapital:0,outcomes:{}});const B=v.get(S);B.tradersCount++;const N=f.initialValue||0;B.totalCapital+=N;const H=f.outcome||"Unknown";B.outcomes[H]||(B.outcomes[H]={tradersCount:0,totalCost:0,totalShares:0,currentPrice:f.curPrice||0,tradersList:[]});const F=B.outcomes[H];F.tradersCount++,F.totalCost+=N,F.totalShares+=f.size||0,F.tradersList.push({name:T,wallet:m.proxyWallet,initialValue:N,outcome:H,shares:f.size||0})}}p=Array.from(v.values()).map(h=>{let m="Unknown",P=0,T=0,f=[];Object.entries(h.outcomes).forEach(([D,E])=>{E.tradersCount>P&&(m=D,P=E.tradersCount,T=E.totalCost,f=E.tradersList)});const A=h.tradersCount>0?P/h.tradersCount*100:0,M=h.tradersCount/100*100;return{...h,consensusOutcome:m,consensusStrength:A,participationRate:M,consensusTradersList:f,dominantOutcomeDetails:h.outcomes[m]}}),s.classList.add("hidden"),e.classList.remove("hidden"),L()}catch(C){console.error(`Error aggregating insights for ${b}:`,C),s.innerHTML=`
          <div class="error-state">
            <svg class="error-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h3 class="error-state__title">Scans Interrupted</h3>
            <p class="error-state__message">Polymarket data rate limits reached. Please refresh to start a cached scan.</p>
            <button class="btn btn--primary" id="retry-insights">Restart Scanner</button>
          </div>
        `,(w=document.getElementById("retry-insights"))==null||w.addEventListener("click",()=>{y=!1,$(b)})}finally{y=!1,o.style.pointerEvents="auto",o.style.opacity="1"}}};await $(g),o.querySelectorAll(".window-btn").forEach(b=>{b.addEventListener("click",async()=>{y||(o.querySelectorAll(".window-btn").forEach(w=>w.classList.remove("active")),b.classList.add("active"),g=b.getAttribute("data-window"),await $(g))})}),c.addEventListener("change",L),d.addEventListener("change",L);function L(){const b=parseInt(c.value,10),w=d.value;let C=p.filter(x=>x.tradersCount>=b);C.sort((x,v)=>w==="participation-desc"?v.tradersCount-x.tradersCount:w==="capital-desc"?v.totalCapital-x.totalCapital:w==="consensus-desc"?v.consensusStrength-x.consensusStrength:0),it(l,C)}}};function it(t,s){if(t!==null){if(s.length===0){t.innerHTML=`
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <h3 class="empty-state__title">No consensus markets found</h3>
        <p class="empty-state__message">Try lowering the minimum trader threshold to see more active markets.</p>
      </div>
    `;return}t.innerHTML=s.map((e,n)=>{const a=e.slug?`https://polymarket.com/market/${e.slug}`:`https://polymarket.com/event/${e.eventSlug||""}`,r=e.icon||'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%231a233a"><rect width="100" height="100"/><text y=".75em" font-size="60" x="15">📈</text></svg>';let i="outcome-badge--neutral";e.consensusOutcome.toLowerCase()==="yes"?i="outcome-badge--yes":e.consensusOutcome.toLowerCase()==="no"&&(i="outcome-badge--no");const c=n<3,d=c?`🔥 TOP ${n+1}`:"";return`
      <div class="insight-card animate-scale-in">
        ${c?`<div class="insight-card__top-badge">${d}</div>`:""}
        
        <div class="insight-card__header">
          <img src="${r}" class="insight-card__icon" alt="Market Icon" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\' fill=\\'%231a233a\\'><rect width=\\'100\\' height=\\'100\\'/><text y=\\'.75em\\' font-size=\\'60\\' x=\\'15\\'>📈</text></svg>';" />
          <div class="insight-card__participation">
            <span class="participation-count">👥 <strong>${e.tradersCount}</strong> of Top 100</span>
            <span class="participation-rate">(${e.participationRate}% Participation)</span>
          </div>
        </div>

        <h4 class="insight-card__title" title="${e.title}">
          <a href="${a}" target="_blank" rel="noopener noreferrer">${e.title}</a>
        </h4>

        <!-- Consensus Tracker -->
        <div class="insight-card__consensus">
          <div class="consensus-info">
            <span class="consensus-info__label">Consensus Bet</span>
            <span class="outcome-badge ${i} font-semibold">${e.consensusOutcome}</span>
            <span class="consensus-info__strength">${e.consensusStrength.toFixed(1)}% Consensus</span>
          </div>
          
          <div class="consensus-meter">
            <div class="consensus-meter__fill" style="width: ${e.consensusStrength}%"></div>
          </div>
        </div>

        <div class="insight-card__details">
          <div class="detail-row">
            <span class="detail-row__label">Total Capital Invested</span>
            <span class="detail-row__value font-mono font-medium text-success">${_(e.totalCapital)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-row__label">Outcome Price</span>
            <span class="detail-row__value font-mono font-medium">${(e.dominantOutcomeDetails.currentPrice*100).toFixed(0)}¢</span>
          </div>
        </div>

        <!-- Consensus Traders list -->
        <div class="insight-card__traders">
          <span class="traders-list-title">Consensus Traders:</span>
          <div class="traders-list-pills">
            ${e.consensusTradersList.map(l=>`
              <span class="trader-pill" title="${l.name} invested ${_(l.initialValue)}">
                ${l.name} <code class="trader-pill__val">${_(l.initialValue,!0)}</code>
              </span>
            `).join("")}
          </div>
        </div>

        <div class="insight-card__footer">
          <a href="${a}" target="_blank" rel="noopener noreferrer" class="insight-card__link">
            Trade Consensus
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="insight-card__link-icon">
              <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
            </svg>
          </a>
        </div>
      </div>
    `}).join("")}}const O=document.getElementById("page-content"),lt=document.querySelectorAll(".nav__link");async function Q(){const t=window.location.hash||"#leaderboard";console.log("[Router] Navigating to:",t),lt.forEach(s=>{const e=s.getAttribute("data-page");t===`#${e}`||e==="leaderboard"&&t.startsWith("#trader/")?s.classList.add("active"):s.classList.remove("active")});try{if(t==="#leaderboard"||t==="")await at.render(O);else if(t.startsWith("#trader/")){const e=t.split("/")[1];await rt.render(O,e)}else t==="#insights"?await ot.render(O):window.location.hash="#leaderboard"}catch(s){console.error("[Router] Error rendering view:",s),O.innerHTML=`
      <div class="error-state">
        <svg class="error-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3 class="error-state__title">Navigation Error</h3>
        <p class="error-state__message">An error occurred while loading this page. Please try again.</p>
        <a href="#leaderboard" class="btn btn--primary">Go to Leaderboard</a>
      </div>
    `}}window.addEventListener("hashchange",Q);Q();
