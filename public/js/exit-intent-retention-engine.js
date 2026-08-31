/**
 * ==============================================================================
 * SMART EXIT-INTENT & MOBILE RETENTION INTERCEPTOR ENGINE (2026)
 * Managed by: CDO (Design & UI/UX) & CRO Specialist
 * ==============================================================================
 * Non-intrusive, high-converting retention modal that captures leaving visitors
 * with tailored high-converting coupon offers.
 */

(function() {
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem('exit_modal_shown')) return;

  function createExitModal() {
    const isTravel = window.location.pathname.includes('gramado') || window.location.pathname.includes('natal') || window.location.pathname.includes('barretos');
    const isTech = window.location.pathname.includes('tech') || window.location.pathname.includes('cyber');
    
    let title = "🎁 Espere! Não vá embora sem seu Cupom Secreto!";
    let desc = "Garanta até 30% OFF em achadinhos e utilidades com cupom de desconto verificado hoje.";
    let link = "https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=exit_intent&slot=retention_popup&sid=exit_shopee_vip";
    let cta = "🔥 Resgatar Meu Cupom Agora";

    if (isTravel) {
      title = "🏨 Vai Viajar? Pegue seu Cupom VIP de Hospedagem!";
      desc = "Economize até 30% no Booking.com e Aluguel de Carros com cancelamento grátis garantido.";
      link = "https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=exit_intent&slot=retention_popup&sid=exit_booking_vip";
      cta = "✈️ Ver Descontos de Hotéis";
    } else if (isTech) {
      title = "🛡️ Proteja seus Dispositivos com 70% OFF!";
      desc = "Assine o NordVPN com 3 meses grátis e criptografia de nível militar hoje.";
      link = "https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=nordvpn&site=exit_intent&slot=retention_popup&sid=exit_nordvpn_vip";
      cta = "🔒 Ativar Proteção com Desconto";
    }

    const modalHtml = `
      <div id="exitIntentBackdrop" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); z-index:999999; display:flex; align-items:center; justify-content:center; padding:16px; font-family:system-ui,-apple-system,sans-serif;">
        <div style="background:linear-gradient(145deg, #181926, #0f1017); border:1px solid rgba(255,215,0,0.4); border-radius:20px; max-width:440px; width:100%; padding:28px 24px; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.9); position:relative; color:#fff;">
          <button id="closeExitModalBtn" style="position:absolute; top:12px; right:12px; background:rgba(255,255,255,0.1); border:none; color:#bbb; width:32px; height:32px; border-radius:50%; font-size:16px; cursor:pointer;">✕</button>
          <div style="font-size:40px; margin-bottom:12px;">⚡</div>
          <h3 style="font-size:1.25rem; font-weight:800; color:#ffd700; margin:0 0 10px 0; line-height:1.3;">${title}</h3>
          <p style="font-size:0.9rem; color:#ccc; margin:0 0 20px 0; line-height:1.5;">${desc}</p>
          <a href="${link}" target="_blank" rel="noopener sponsored" id="exitClaimBtn" style="display:block; background:linear-gradient(90deg, #ffd700, #ff9900); color:#000; font-weight:800; padding:14px 20px; border-radius:12px; text-decoration:none; font-size:1rem; box-shadow:0 8px 25px rgba(255,153,0,0.4); transition:all 0.2s;">${cta}</a>
          <span style="display:block; font-size:0.75rem; color:#888; margin-top:12px;">🔒 Link oficial criptografado & sem anúncios invasivos</span>
        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    document.body.appendChild(div);

    sessionStorage.setItem('exit_modal_shown', 'true');

    document.getElementById('closeExitModalBtn').addEventListener('click', function() {
      document.getElementById('exitIntentBackdrop').remove();
    });

    document.getElementById('exitClaimBtn').addEventListener('click', function() {
      document.getElementById('exitIntentBackdrop').remove();
    });
  }

  // Desktop Mouse Leave Trigger
  document.addEventListener('mouseleave', function(e) {
    if (e.clientY <= 5 && !sessionStorage.getItem('exit_modal_shown')) {
      createExitModal();
    }
  });

  // Mobile Back-Button / History State Interceptor
  if (window.history && window.history.pushState) {
    window.history.pushState({ page: 1 }, '', '');
    window.addEventListener('popstate', function(e) {
      if (!sessionStorage.getItem('exit_modal_shown')) {
        createExitModal();
      }
    });
  }
})();
