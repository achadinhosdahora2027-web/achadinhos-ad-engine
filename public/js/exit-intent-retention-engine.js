/**
 * ==============================================================================
 * SMART EXIT-INTENT & MOBILE BOUNCE RETENTION INTERCEPTOR ENGINE (2026)
 * Managed by: CDO (Design & UI/UX) & Chief CRO Strategist
 * ==============================================================================
 * 1. Non-intrusive, high-converting retention drawer capturing leaving visitors.
 * 2. Multi-niche auto-detection: Travel, Tarot/Astrology, Tech/Security, Home/Coupons.
 * 3. Mobile gesture & back-button interception (Popstate + 55% scroll pause).
 * 4. Desktop mouseleave top boundary trigger.
 * 5. One-click dynamic affiliate redirection with verified tracking SID.
 */

(function() {
  'use strict';
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem('exit_retention_shown')) return;

  function detectContext() {
    const p = window.location.pathname.toLowerCase();
    if (p.includes('gramado') || p.includes('natal') || p.includes('barretos') || p.includes('viag') || p.includes('hotel') || p.includes('booking') || p.includes('tour')) {
      return {
        type: 'travel',
        icon: '✈️',
        title: '🏨 Vai Viajar? Não Perca até 30% OFF em Hospedagens!',
        desc: 'Compare hotéis e pousadas com cancelamento grátis e menor tarifa garantida no Booking.com.',
        cta: '🌟 Ver Ofertas de Hotéis no Booking',
        link: 'https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=exit_drawer&slot=travel_retention&sid=exit_booking_cro'
      };
    }
    if (p.includes('tarot') || p.includes('signo') || p.includes('compatibilidade') || p.includes('horoscopo') || p.includes('entretenimento')) {
      return {
        type: 'tarot',
        icon: '🔮',
        title: '✨ Desbloqueie seu Cupom Astral do Dia!',
        desc: 'Achadinhos místicos, incensos, cristais e utilidades com cupons secretos e Frete Grátis na Shopee.',
        cta: '🎁 Resgatar Meu Cupom Shopee',
        link: 'https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=exit_drawer&slot=tarot_retention&sid=exit_shopee_tarot'
      };
    }
    if (p.includes('vpn') || p.includes('tech') || p.includes('seguran') || p.includes('curso') || p.includes('ia') || p.includes('software')) {
      return {
        type: 'tech',
        icon: '🛡️',
        title: '🔒 Proteja sua Navegação com 74% OFF + 3 Meses Grátis!',
        desc: 'Navegue de forma 100% anônima, libere streamings mundiais e bloqueie malwares com a NordVPN.',
        cta: '🚀 Ativar Desconto Militar NordVPN',
        link: 'https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=nordvpn&site=exit_drawer&slot=tech_retention&sid=exit_nordvpn_cro'
      };
    }
    // Universal Shopping & VIP Deals
    return {
      type: 'deals',
      icon: '🛍️',
      title: '🎁 Espere! Não vá embora sem os Cupons Verificados de Hoje!',
      desc: 'Mais de 1.400 ofertas com frete grátis, descontos até 70% OFF e cupons exclusivos da Shopee e Amazon.',
      cta: '🔥 Ver Cupons Secretos de Hoje',
      link: 'https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=exit_drawer&slot=global_retention&sid=exit_shopee_deals'
    };
  }

  function showRetentionDrawer() {
    if (sessionStorage.getItem('exit_retention_shown')) return;
    sessionStorage.setItem('exit_retention_shown', 'true');

    const ctx = detectContext();

    const drawer = document.createElement('div');
    drawer.id = 'exitRetentionDrawer';
    drawer.innerHTML = `
      <div style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(2, 6, 23, 0.85); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:9999999; display:flex; align-items:center; justify-content:center; padding:16px; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; animation: fadeInModal 0.25s ease-out;">
        <div style="background:linear-gradient(145deg, #0f172a, #1e1b4b); border:1px solid rgba(245, 158, 11, 0.4); border-radius:24px; max-width:440px; width:100%; padding:28px 22px; text-align:center; box-shadow:0 25px 60px rgba(0,0,0,0.85); position:relative; color:#f8fafc;">
          
          <button id="closeExitDrawerBtn" style="position:absolute; top:12px; right:12px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#94a3b8; width:32px; height:32px; border-radius:50%; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">✕</button>
          
          <div style="font-size:3rem; line-height:1; margin-bottom:12px;">${ctx.icon}</div>
          <span style="display:inline-block; background:rgba(245, 158, 11, 0.15); color:#fbbf24; border:1px solid rgba(245, 158, 11, 0.3); font-size:0.75rem; font-weight:800; padding:4px 12px; border-radius:20px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">OFERTA EXCLUSIVA DE SAÍDA</span>
          
          <h3 style="font-size:1.25rem; font-weight:800; color:#f8fafc; margin:0 0 10px 0; line-height:1.35; letter-spacing:-0.3px;">${ctx.title}</h3>
          <p style="font-size:0.88rem; color:#cbd5e1; margin:0 0 20px 0; line-height:1.45;">${ctx.desc}</p>
          
          <a href="${ctx.link}" target="_blank" rel="sponsored noopener noreferrer nofollow" id="claimExitRewardBtn" style="display:flex; align-items:center; justify-content:center; gap:8px; background:linear-gradient(135deg, #f59e0b, #ea580c); color:#ffffff; font-weight:800; padding:15px 20px; border-radius:14px; text-decoration:none; font-size:0.98rem; box-shadow:0 10px 30px rgba(234, 88, 12, 0.4); transition:all 0.2s; border:none;">
            ${ctx.cta}
          </a>
          
          <div style="display:flex; align-items:center; justify-content:center; gap:6px; margin-top:14px; font-size:0.75rem; color:#94a3b8;">
            <span>🛡️</span>
            <span>Link seguro & verificado • Parceiro Oficial 2026</span>
          </div>
        </div>
      </div>
      <style>
        @keyframes fadeInModal {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      </style>
    `;

    document.body.appendChild(drawer);

    const closeBtn = document.getElementById('closeExitDrawerBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        const el = document.getElementById('exitRetentionDrawer');
        if (el) el.remove();
      });
    }

    const claimBtn = document.getElementById('claimExitRewardBtn');
    if (claimBtn) {
      claimBtn.addEventListener('click', function() {
        const el = document.getElementById('exitRetentionDrawer');
        if (el) el.remove();
      });
    }
  }

  // 1. Desktop Trigger: Mouse leaves viewport via top boundary
  document.addEventListener('mouseleave', function(e) {
    if (e.clientY <= 5) {
      showRetentionDrawer();
    }
  });

  // 2. Mobile History Popstate Interceptor
  if (window.history && window.history.pushState) {
    try {
      window.history.pushState({ achadinhosRetention: 1 }, '', '');
      window.addEventListener('popstate', function() {
        showRetentionDrawer();
      });
    } catch(e) {}
  }

  // 3. Mobile Time & Scroll Engagement Trigger (After 30s + 40% scroll)
  let scrolled = false;
  window.addEventListener('scroll', function() {
    const scrollPos = window.scrollY + window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;
    if (docHeight > 0 && (scrollPos / docHeight) > 0.45) {
      scrolled = true;
    }
  }, { passive: true });

  setTimeout(function() {
    if (scrolled && !sessionStorage.getItem('exit_retention_shown')) {
      showRetentionDrawer();
    }
  }, 28000);

})();
