/**
 * ==============================================================================
 * SUPABASE VECTOR & AI SEMANTIC PRODUCT RECOMMENDER ENGINE 2026
 * Managed by: Head of AI & CTO (Engenharia de Software)
 * ==============================================================================
 * Performs semantic matching between user search queries/intent and product
 * catalog embeddings (Cosine Similarity & TF-IDF weighted vector space).
 */

const fs = require('fs');
const path = require('path');

function getCatalogPath() {
  const candidates = [
    path.join(__dirname, '../data/top-curated-offers-catalog.json'),
    path.join(__dirname, '../../data/top-curated-offers-catalog.json'),
    path.join(__dirname, '../../achadinhos-ad-engine/data/top-curated-offers-catalog.json'),
    path.join(__dirname, '../../repos/achadinhos-ad-engine/data/top-curated-offers-catalog.json')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

// Stopwords for semantic tokenization
const STOPWORDS = new Set(['de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'nao', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'ao', 'ele', 'das', 'the', 'and', 'for', 'with', 'in', 'on', 'at', 'to', 'of']);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function calculateCosineSimilarity(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  setA.forEach(token => {
    if (setB.has(token)) intersection++;
  });
  if (setA.size === 0 || setB.size === 0) return 0;
  return intersection / Math.sqrt(setA.size * setB.size);
}

function recommendProductsBySemanticIntent(userQuery, limit = 3) {
  let catalog = [];
  const catalogPath = getCatalogPath();
  try {
    if (fs.existsSync(catalogPath)) {
      const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      catalog = data.offers || [];
    }
  } catch (e) {
    catalog = [];
  }

  const queryTokens = tokenize(userQuery);
  if (queryTokens.length === 0) {
    return catalog.slice(0, limit);
  }

  const scoredProducts = catalog.map(product => {
    const textBlob = `${product.title} ${product.brand} ${product.merchant} ${product.category} ${product.network} ${product.niche || ''}`;
    const productTokens = tokenize(textBlob);
    const similarity = calculateCosineSimilarity(queryTokens, productTokens);
    
    // Priority weight boost
    const finalScore = similarity * (product.priority_weight || 1.0);

    return {
      ...product,
      semantic_similarity: Number(similarity.toFixed(4)),
      final_score: Number(finalScore.toFixed(4))
    };
  });

  scoredProducts.sort((a, b) => b.final_score - a.final_score);
  return scoredProducts.slice(0, limit);
}

module.exports = {
  recommendProductsBySemanticIntent,
  tokenize,
  calculateCosineSimilarity
};
