import axios from 'axios';

const log = (msg) => console.log(`[MonochromeProvider] ${msg}`);

export default class MonochromeProvider {
  name = 'monochrome';
  displayName = 'Monochrome';
  sidecarUrl = process.env.STREAM_RESOLVER_URL || 'http://127.0.0.1:3100';
  lastManualJwtAt = 0;
  REFRESH_COOLDOWN = 2 * 60 * 1000;

  markJwtValid() {
    this.lastManualJwtAt = Date.now();
    log('Manual JWT set — skipping auto-refresh for cooldown');
  }

  async health() {
    try {
      const resp = await axios.get(`${this.sidecarUrl}/health`, { timeout: 5000 });
      const { ready, jwtValid } = resp.data || {};

      if (ready && jwtValid) {
        return { online: true, details: `ready=${ready} jwtValid=${jwtValid}` };
      }

      if (Date.now() - this.lastManualJwtAt < this.REFRESH_COOLDOWN) {
        log('JWT invalid but within manual cooldown — waiting');
        return { online: false, details: `ready=${ready} jwtValid=${jwtValid} (cooldown)` };
      }

      if (ready && !jwtValid) {
        log('JWT missing/expired — attempting auto-refresh...');
        const refreshed = await this.refresh();
        if (refreshed) {
          const recheck = await axios.get(`${this.sidecarUrl}/health`, { timeout: 5000 });
          const { jwtValid: afterRefresh } = recheck.data || {};
          if (afterRefresh) {
            return { online: true, details: `refreshed jwtValid=true` };
          }
        }
        return { online: false, details: `refresh failed ready=${ready} jwtValid=${jwtValid}` };
      }

      return { online: false, details: `ready=${ready} jwtValid=${jwtValid}` };
    } catch (e) {
      return { online: false, details: e.message };
    }
  }

  async refresh() {
    try {
      log('Requesting JWT refresh from sidecar...');
      const resp = await axios.get(`${this.sidecarUrl}/refresh`, { timeout: 30000 });
      const ok = resp.data?.ok;
      log(`Refresh result: ok=${ok} jwtValid=${resp.data?.jwtValid}`);
      return ok;
    } catch (e) {
      log(`Refresh failed: ${e.message}`);
      return false;
    }
  }

  async stream(songData) {
    const trackTitle = songData.title || 'Unknown';
    const artist = songData.author?.name || 'Unknown';
    const duration = songData.duration?.seconds || 0;

    const params = new URLSearchParams({
      track: trackTitle,
      artist,
      album: '',
      duration: String(duration),
      quality: 'SD_LOW',
    });

    const resp = await axios.get(`${this.sidecarUrl}/stream?${params.toString()}`, {
      timeout: 15000,
    });

    if (!resp.data?.streamUrl) {
      const detail = resp.data?.error || resp.data?.detail || JSON.stringify(resp.data);
      throw new Error(detail);
    }

    return {
      streamUrl: resp.data.streamUrl,
      decryptionKey: resp.data.decryptionKey || null,
      quality: resp.data.quality,
    };
  }
}
