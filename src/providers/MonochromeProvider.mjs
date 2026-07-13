import axios from 'axios';

const log = (msg) => console.log(`[MonochromeProvider] ${msg}`);

export default class MonochromeProvider {
  name = 'monochrome';
  displayName = 'Monochrome';
  sidecarUrl = process.env.STREAM_RESOLVER_URL || 'http://127.0.0.1:3100';

  async health() {
    try {
      const resp = await axios.get(`${this.sidecarUrl}/health`, { timeout: 5000 });
      const { ready, jwtValid } = resp.data || {};
      return { online: !!(ready && jwtValid), details: `ready=${ready} jwtValid=${jwtValid}` };
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
