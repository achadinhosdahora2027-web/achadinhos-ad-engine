#!/usr/bin/env bash
# ==============================================================================
# EXECUTOR DO ORQUESTRADOR MESTRE  (v3 — 13/09/2026)
# ==============================================================================
# HISTORICO DAS FALHAS CORRIGIDAS AQUI:
#
#  v1  O workflow rodava   node scripts/xyz.js || true   para cada etapa.
#      O `|| true` engolia TUDO. 5 scripts apareciam como "executados com
#      sucesso" e simplesmente nao existiam no repositorio. O painel dizia
#      "SISTEMA 100% ALINHADO 24/7" enquanto 5 das 18 etapas nao rodavam nada.
#
#  v2  Passou a classificar cada etapa em OK / AUSENTE / FALHOU. Mas ainda
#      (a) nao carregava credenciais, entao tudo que precisa de token falhava,
#      (b) so olhava o repositorio do motor. 4 dos 5 scripts "ausentes"
#      existiam no repositorio do SITE (aquitemachadinhos) — o orquestrador
#      mestre sempre foi um sistema de DOIS repositorios lado a lado: os
#      scripts do site importam   ../../achadinhos-ad-engine/data/*.json .
#      (c) tinha um bug de `set -u`: a linha de erro referenciava uma variavel
#      `exit_code` que nunca era declarada.
#
#  v3  (este arquivo)
#      - Carrega credenciais de .env / $ENV_FILE antes de rodar as etapas.
#      - Resolve cada script no repositorio do motor E no repositorio do site.
#      - Executa cada etapa no diretorio do repositorio dono do script, porque
#        os scripts usam caminhos relativos (__dirname/../data).
#      - Mostra no inicio quais credenciais estao presentes e quais faltam.
#      - Explica cada etapa com um rotulo honesto (o que ela REALMENTE faz).
#
# LAYOUT ESPERADO (local e no CI):
#     <raiz>/achadinhos-ad-engine/     <- este repositorio (motor + gateway)
#     <raiz>/aquitemachadinhos/        <- repositorio do site
#   Variavel SITE_REPO sobrescreve o caminho do repositorio do site.
# ==============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_REPO="${SITE_REPO:-$ROOT/../aquitemachadinhos}"

# ------------------------------------------------------------------ credenciais
for candidate in "${ENV_FILE:-}" "$ROOT/.env" "$ROOT/../.env" "$SITE_REPO/.env"; do
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$candidate"
    set +a
    echo "🔑 Credenciais carregadas de: $candidate"
    break
  fi
done

OK=0; MISSING=0; FAILED=0
FAILED_LIST=(); MISSING_LIST=(); OK_LIST=()

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  ORQUESTRADOR MESTRE — INVENTARIO DE AMBIENTE"
echo "═══════════════════════════════════════════════════════════════════════"
printf '  %-24s %s\n' "Repositorio do motor:" "$ROOT"
printf '  %-24s %s\n' "Repositorio do site :" "$SITE_REPO $([ -d "$SITE_REPO" ] && echo '(presente)' || echo '(AUSENTE!)')"
echo ""
echo "  Credenciais:"
for var in TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_DEALS_CHANNEL SUPABASE_URL SUPABASE_SERVICE_KEY \
           SUPABASE_SERVICE_ROLE_KEY TWITTER_BEARER_TOKEN META_ACCESS_TOKEN META_PAGE_TOKEN_A \
           INSTAGRAM_ACCESS_TOKEN BING_WEBMASTER_API_KEY YANDEX_OAUTH_TOKEN CRON_SECRET INDEXNOW_KEY; do
  if [ -n "${!var:-}" ]; then printf '    ✅ %s\n' "$var"; else printf '    ⚠️  %s (ausente)\n' "$var"; fi
done

# ------------------------------------------------------------------ resolvedor
# Procura o script no repositorio do motor primeiro, depois no do site.
# Devolve "REPO|CAMINHO_RELATIVO" ou vazio.
resolve_script() {
  local rel="$1"
  if [ -f "$ROOT/$rel" ]; then printf '%s|%s' "$ROOT" "$rel"; return 0; fi
  if [ -f "$SITE_REPO/$rel" ]; then printf '%s|%s' "$SITE_REPO" "$rel"; return 0; fi
  printf ''
  return 1
}

run_step() {
  local label="$1"; shift
  local rel="$1"; shift || true

  echo ""
  echo "───────────────────────────────────────────────────────────────────────"
  printf '▶ %s\n' "$label"
  echo "───────────────────────────────────────────────────────────────────────"

  local resolved
  resolved="$(resolve_script "$rel")"
  if [ -z "$resolved" ]; then
    echo "⚠️  AUSENTE: $rel nao existe em nenhum dos dois repositorios."
    MISSING=$((MISSING+1)); MISSING_LIST+=("$label")
    return 0
  fi
  local repo="${resolved%%|*}"
  local path="${resolved#*|}"
  local origin="motor"; [ "$repo" = "$SITE_REPO" ] && origin="site"
  echo "↳ $origin: ${path#scripts/}"

  local code=0
  ( cd "$repo" && node "$path" "$@" ) || code=$?

  if [ "$code" -eq 0 ]; then
    OK=$((OK+1)); OK_LIST+=("$label")
  else
    extra_env=""
    if [ "$code" -eq 1 ] && [ "${ALLOW_EXIT1:-0}" = "1" ]; then
      echo "⚠️  saiu com codigo 1 (tolerado por ALLOW_EXIT1=1)"
      OK=$((OK+1)); OK_LIST+=("$label (exit 1 tolerado)")
      return 0
    fi
    echo "❌ FALHOU (exit=$code): $rel  [repo $origin]"
    FAILED=$((FAILED+1)); FAILED_LIST+=("$label  (exit $code)")
  fi
  return 0
}

# ==============================================================================
#  ETAPAS — a ordem e a lista refletem o que REALMENTE existe e roda
# ==============================================================================
run_step "1. Governanca hierarquica autonoma"        scripts/autonomous-hierarchical-governance-engine.js
run_step "2. Ledger de memoria e escalonamento"      scripts/autonomous-memory-ledger-engine.js
run_step "3. Envio ao Bing Webmaster"                scripts/bing-webmaster-sync.js
run_step "4. Envio ao Yandex Webmaster"              scripts/yandex-webmaster-sync.js
run_step "5. Watchdog de links e impressoes"         scripts/affiliate-impressions-and-links-watchdog.js
run_step "6. Producao controlada de ofertas"         scripts/controlled-production-learning-engine.js
run_step "7. Enxame de captura social 300k"          scripts/ultra-300k-planetary-swarm-engine.js
run_step "8. Pinterest Rich Pins"                    scripts/pinterest-rich-pin-engine.js
run_step "9. Sincronizacao do Meta Commerce"         scripts/meta-commerce-catalog-sync.js
run_step "10. Magnet de trafego Tarot"               scripts/tarot-viral-traffic-magnet.js
run_step "11. Otimizador Google Search Console"      scripts/google-search-console-optimizer.js
run_step "12. Pinger multi-motor global"             scripts/multi-engine-global-pinger.js
run_step "13. Validador de cupons e precos"          scripts/coupon-radar-validator.js
run_step "14. Reconstrucao dos links do catalogo"    scripts/rebuild-catalog-links.js
run_step "15. Guarda do gateway + TAGS dos destinos" scripts/affiliate-gateway-tag-health.js
run_step "16. Canario de afiliados do site (live)"   scripts/affiliate-health-check.js
run_step "17. Paginas de tag SEO"                    scripts/generate-tag-seo-pages.js
run_step "18. Rascunhos para grupos do Facebook"     scripts/facebook-group-syndication-engine.js
run_step "19. Responder de comentarios Instagram"    scripts/instagram-comments-auto-responder.js
run_step "20. ENTREGADOR TELEGRAM MULTI-DESTINO"     scripts/telegram-brazil-deals-publisher.js
run_step "21. Sitemaps sincronizados (100% paginas)" scripts/sync-sitemaps.js
run_step "22. Auditoria de schemas JSON-LD"          scripts/audit-schemas.js
run_step "23. Suite global omni-teste 195 paises"    scripts/master-global-omni-test-suite.js

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  RESUMO DO ORQUESTRADOR"
echo "═══════════════════════════════════════════════════════════════════════"
echo "  ✅ Executadas com sucesso : $OK"
echo "  ⚠️  Ausentes nos 2 repos   : $MISSING"
echo "  ❌ Falharam de verdade    : $FAILED"

if [ ${#MISSING_LIST[@]} -gt 0 ]; then
  echo ""
  echo "  Etapas ausentes:"
  for m in "${MISSING_LIST[@]}"; do echo "     • $m"; done
fi

if [ ${#FAILED_LIST[@]} -gt 0 ]; then
  echo ""
  echo "  Etapas que FALHARAM:"
  for f in "${FAILED_LIST[@]}"; do echo "     • $f"; done
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════"
  exit 1
fi

echo ""
echo "  Todas as etapas existentes rodaram sem erro."
echo "═══════════════════════════════════════════════════════════════════════"
exit 0
