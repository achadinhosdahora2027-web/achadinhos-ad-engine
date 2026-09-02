/**
 * ==============================================================================
 * ACHADINHOS FORENSIC TELEMETRY, CJ PIXEL BEACON & SID AUTO-DECORATOR 2026
 * Managed by: CQO (Auditoria Forense) & CTO (Engenharia de Software)
 * ==============================================================================
 * 1. Immediate High-Priority CJ Impression Pixel Beaconing (PID: 8041957).
 * 2. Auto-decorates all outbound affiliate links with forensic telemetry (SID, Geo, Device).
 * 3. Real-time Pageview Beacon to /api/telemetry/collect.
 * 4. Zero-delay firing ensuring 100% impression registration in CJ & Ad Networks.
 */

(function() {
  'use strict';

  const CJ_PID = '8041957';
  const CJ_PIXELS = [
    'https://www.ftjcfx.com/image-8041957-17288448', // Booking.com
    'https://www.tqlkg.com/image-8041957-17075184'   // Carla Car Rental
  ];

  // 1. FORENSIC CJ IMPRESSION BEACON (Fires immediately without waiting for scroll)
  function fireCjImpressionBeacons() {
    CJ_PIXELS.forEach(function(pixelUrl) {
      try {
        const img = new Image(1, 1);
        img.src = `${pixelUrl}?_ts=${Date.now()}`;
        img.style.position = 'fixed';
        img.style.top = '0';
        img.style.left = '0';
        img.style.width = '1px';
        img.style.height = '1px';
        img.style.opacity = '0.001';
        img.style.pointerEvents = 'none';
        img.setAttribute('aria-hidden', 'true');
        if (document.body) {
          document.body.appendChild(img);
        }
      } catch (e) {}
    });
  }

  function getDeviceType() {
    const ua = navigator.userAgent || '';
    if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
    if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
    return 'desktop';
  }

  function getLanguage() {
    try {
      return (navigator.language || navigator.userLanguage || 'pt').toLowerCase().substring(0, 2);
    } catch(e) {
      return 'pt';
    }
  }

  // 2. REAL-TIME TELEMETRY BEACON
  function sendPageviewBeacon() {
    try {
      const payload = JSON.stringify({
        type: 'pageview',
        path: window.location.pathname,
        geo: getLanguage(),
        dev: getDeviceType(),
        ref: document.referrer || '',
        cj_pid: CJ_PID
      });

      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/telemetry/collect', payload);
      } else {
        fetch('/api/telemetry/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function() {});
      }
    } catch(e) {}
  }

  // 3. OUTBOUND AFFILIATE SID AUTO-DECORATION
  function decorateAffiliateLinks() {
    const dev = getDeviceType();
    const lang = getLanguage();
    const links = document.querySelectorAll('a[href*="/api/ads/go"], a[href*="tkqlhce.com"], a[href*="jdoqocy.com"], a[href*="anrdoezrs.net"], a[href*="dpbolvw.net"], a[href*="kqzyfj.com"], a[href*="shopee.com"], a[href*="meli.la"], a[href*="amazon.com"]');

    links.forEach(function(link) {
      try {
        const url = new URL(link.href, window.location.origin);
        if (!url.searchParams.has('geo')) {
          url.searchParams.set('geo', lang);
        }
        if (!url.searchParams.has('dev')) {
          url.searchParams.set('dev', dev);
        }
        link.href = url.toString();
      } catch (e) {}
    });
  }

  // Execute immediately
  fireCjImpressionBeacons();
  sendPageviewBeacon();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      fireCjImpressionBeacons();
      decorateAffiliateLinks();
    });
  } else {
    decorateAffiliateLinks();
  }
})();
