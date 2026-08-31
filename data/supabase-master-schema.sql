-- ==============================================================================
-- SUPABASE MASTER ORCHESTRATION SCHEMA: AQUI TEM ACHADINHOS 2026
-- Automated Distribution, Performance Scoring, Queue, Metrics & Multi-Agent Gov
-- ==============================================================================

-- 1. Canais Elegíveis (Facebook Pages, Instagram Accounts, Twitter, Telegram)
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL, -- 'facebook', 'instagram', 'twitter', 'telegram'
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT,
  type TEXT DEFAULT 'business',
  country TEXT DEFAULT 'BR',
  language TEXT DEFAULT 'pt',
  category TEXT DEFAULT 'deals_lifestyle',
  status TEXT DEFAULT 'active',
  eligibility BOOLEAN DEFAULT TRUE,
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Sistema de Pontuação e Inteligência de Canais (Channel Scores)
CREATE TABLE IF NOT EXISTS channel_scores (
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  ctr NUMERIC(6,4) DEFAULT 0.0000,
  engagement_rate NUMERIC(6,4) DEFAULT 0.0000,
  conversion_rate NUMERIC(6,4) DEFAULT 0.0000,
  revenue_brl NUMERIC(12,2) DEFAULT 0.00,
  recency_score NUMERIC(6,4) DEFAULT 1.0000,
  audience_match_score NUMERIC(6,4) DEFAULT 0.8500,
  historical_score NUMERIC(6,4) DEFAULT 0.8000,
  composite_score NUMERIC(6,4) DEFAULT 0.8200,
  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(channel_id)
);

-- 3. Catálogo de Produtos e Ofertas Globais de Afiliados
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  merchant TEXT NOT NULL,
  network TEXT NOT NULL, -- 'cj', 'shopee', 'booking', 'carla', 'nordvpn', 'udemy', 'meli', 'amazon'
  category TEXT NOT NULL,
  price NUMERIC(10,2),
  currency TEXT DEFAULT 'BRL',
  country TEXT DEFAULT 'BR',
  language TEXT DEFAULT 'pt',
  affiliate_url TEXT NOT NULL,
  image_url TEXT,
  epc NUMERIC(8,4) DEFAULT 0.0000,
  conversion_rate NUMERIC(6,4) DEFAULT 0.0000,
  commission_percent NUMERIC(6,2) DEFAULT 8.00,
  trend_score NUMERIC(6,4) DEFAULT 1.0000,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Ofertas Promocionais, Vouchers e Badges de Desconto
CREATE TABLE IF NOT EXISTS affiliate_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  discount_code TEXT,
  discount_percent NUMERIC(5,2),
  badge TEXT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Conteúdo Mestre Gerado para Distribuição
CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  cta TEXT NOT NULL,
  platform TEXT NOT NULL,
  language TEXT DEFAULT 'pt',
  country TEXT DEFAULT 'BR',
  format TEXT DEFAULT 'feed_post', -- 'feed_post', 'story', 'carousel', 'tweet'
  image_url TEXT,
  affiliate_link TEXT NOT NULL,
  hashtags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Variações de Conteúdo para Testes A/B (A/B Testing Engine)
CREATE TABLE IF NOT EXISTS content_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  title_variant TEXT NOT NULL,
  cta_variant TEXT NOT NULL,
  copy_variant TEXT NOT NULL,
  ab_group TEXT DEFAULT 'A', -- 'A' ou 'B'
  score NUMERIC(6,4) DEFAULT 0.0000,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Fila de Publicação Autônoma com Chave Idempotente
CREATE TABLE IF NOT EXISTS publication_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  country TEXT DEFAULT 'BR',
  language TEXT DEFAULT 'pt',
  scheduled_at TIMESTAMPTZ NOT NULL,
  priority NUMERIC(6,4) DEFAULT 1.0000,
  score NUMERIC(6,4) DEFAULT 0.8000,
  status TEXT DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'RETRY', 'CANCELLED', 'BLOCKED'
  attempts INT DEFAULT 0,
  last_error TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Registro de Publicações Concluídas
CREATE TABLE IF NOT EXISTS publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID REFERENCES publication_queue(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  post_id TEXT,
  permalink TEXT,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'PUBLISHED'
);

-- 9. Métricas de Performance das Publicações
CREATE TABLE IF NOT EXISTS publication_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID REFERENCES publications(id) ON DELETE CASCADE,
  impressions INT DEFAULT 0,
  reach INT DEFAULT 0,
  likes INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  saves INT DEFAULT 0,
  clicks INT DEFAULT 0,
  ctr NUMERIC(6,4) DEFAULT 0.0000,
  conversions INT DEFAULT 0,
  revenue_brl NUMERIC(10,2) DEFAULT 0.00,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Inteligência sobre Comentários e Interações (Comment Intelligence)
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  post_id TEXT NOT NULL,
  comment_external_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT DEFAULT 'pt',
  classification TEXT NOT NULL, -- 'INTERESSE_DE_COMPRA', 'DUVIDA', 'PEDIDO_DE_LINK', 'RECOMENDACAO', 'ELOGIO', 'RECLAMACAO', 'SPAM', 'IRRELEVANTE'
  intent_confidence NUMERIC(4,2) DEFAULT 0.95,
  status TEXT DEFAULT 'pending_action', -- 'pending_action', 'responded', 'ignored', 'human_review'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Ações Automatizadas sobre Comentários (com Spintax & Jitter)
CREATE TABLE IF NOT EXISTS comment_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- 'public_reply', 'dm_send', 'human_escalation'
  response_text TEXT NOT NULL,
  affiliate_link TEXT,
  jitter_delay_ms INT DEFAULT 12000,
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Experimentos Científicos e Validação A/B
CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  variable_tested TEXT NOT NULL, -- 'cta', 'image', 'title', 'timing', 'language'
  variant_a_id UUID REFERENCES content_variants(id),
  variant_b_id UUID REFERENCES content_variants(id),
  status TEXT DEFAULT 'running', -- 'running', 'concluded', 'insufficient_data'
  winner_id UUID,
  p_value NUMERIC(6,4),
  sample_size INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  concluded_at TIMESTAMPTZ
);

-- 13. Metas Oficiais e Acompanhamento de Performance (Goal Monitor)
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period TEXT NOT NULL, -- 'sprint_21_days', 'month_1_30d', 'year_1_2026'
  target_revenue_brl NUMERIC(12,2) NOT NULL,
  target_pageviews BIGINT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT 'in_progress',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Histórico Diário de Atingimento de Metas (Goal Progress)
CREATE TABLE IF NOT EXISTS goal_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  recorded_date DATE DEFAULT CURRENT_DATE,
  current_revenue_brl NUMERIC(12,2) DEFAULT 0.00,
  current_pageviews BIGINT DEFAULT 0,
  pace_percent NUMERIC(5,2) DEFAULT 0.00,
  projected_month_end_brl NUMERIC(12,2),
  recovery_mode_active BOOLEAN DEFAULT FALSE,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. Registro de Execução dos Workflows Autônomos (Automation Runs)
CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'RUNNING', 'COMPLETED', 'FAILED'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  items_processed INT DEFAULT 0,
  items_failed INT DEFAULT 0,
  logs JSONB DEFAULT '{}'
);

-- 16. Registro e Autocura de Falhas de Automação (Automation Errors)
CREATE TABLE IF NOT EXISTS automation_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
  workflow_name TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  resolution_status TEXT DEFAULT 'auto_healed', -- 'auto_healed', 'retrying', 'manual_attention'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. Monitor de Saúde e Heartbeat do Sistema (System Health)
CREATE TABLE IF NOT EXISTS system_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT NOT NULL, -- 'meta_graph_api', 'supabase_edge', 'manychat_api', 'twitter_v2_api', 'indexnow_engine'
  status TEXT NOT NULL, -- 'healthy', 'degraded', 'offline'
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  response_time_ms INT DEFAULT 120,
  failure_count INT DEFAULT 0,
  health_score INT DEFAULT 100
);

-- Índices de Alta Performance
CREATE INDEX IF NOT EXISTS idx_publication_queue_status_sched ON publication_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_publication_queue_idempotency ON publication_queue(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_products_network_cat ON products(network, category, status);
CREATE INDEX IF NOT EXISTS idx_comments_status_class ON comments(status, classification);
CREATE INDEX IF NOT EXISTS idx_system_health_comp ON system_health(component, status);
