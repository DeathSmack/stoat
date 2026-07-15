import MonochromeProvider from './MonochromeProvider.mjs';
import DoubledoubleProvider from './DoubledoubleProvider.mjs';

const log = (msg) => console.log(`[ProviderManager] ${msg}`);

export default class ProviderManager {
  providers = [];
  healthCache = new Map();
  HEALTH_CACHE_TTL = 2 * 60 * 1000;

  constructor() {
    this.providers = [
      new MonochromeProvider(),
      new DoubledoubleProvider(),
    ];
    log(`Initialized ${this.providers.length} providers: ${this.providers.map(p => p.displayName).join(', ')}`);
  }

  async checkHealth() {
    const results = {};
    for (const provider of this.providers) {
      const cached = this.healthCache.get(provider.name);
      if (cached && Date.now() - cached.ts < this.HEALTH_CACHE_TTL) {
        results[provider.name] = cached.result;
        continue;
      }
      const result = await provider.health();
      this.healthCache.set(provider.name, { result, ts: Date.now() });
      results[provider.name] = result;
    }
    return results;
  }

  getHealthyProviders() {
    const healthy = [];
    for (const provider of this.providers) {
      const cached = this.healthCache.get(provider.name);
      if (cached?.result?.online) {
        healthy.push(provider);
      }
    }
    return healthy;
  }

  getOnlineCount() {
    return this.getHealthyProviders().length;
  }

  getProviderStatus() {
    return this.providers.map(p => {
      const cached = this.healthCache.get(p.name);
      return {
        name: p.displayName,
        key: p.name,
        online: cached?.result?.online ?? null,
        details: cached?.result?.details ?? 'not checked',
      };
    });
  }

  async stream(songData, emit) {
    const tried = [];

    for (const provider of this.providers) {
      const cached = this.healthCache.get(provider.name);
      if (cached && !cached.result?.online) {
        tried.push({ provider: provider.displayName, error: 'offline (cached)' });
        continue;
      }

      try {
        if (emit) emit(`\`🔗\` Trying ${provider.displayName}...`);
        log(`Attempting stream via ${provider.displayName}`);

        const result = await provider.stream(songData);
        log(`${provider.displayName} succeeded`);
        return { ...result, provider: provider.name };
      } catch (e) {
        log(`${provider.displayName} failed: ${e.message}`);
        tried.push({ provider: provider.displayName, error: e.message });
        this.healthCache.set(provider.name, { result: { online: false, details: e.message }, ts: Date.now() });
        if (emit) emit(`\`⛓️\` ${provider.displayName} failed, trying next...`);
      }
    }

    throw new Error(`All providers failed: ${tried.map(t => `${t.provider} (${t.error})`).join('; ')}`);
  }
}
