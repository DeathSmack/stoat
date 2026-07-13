import axios from 'axios';

const log = (msg) => console.log(`[LucidaProvider] ${msg}`);

const LUCIDA_BASE = 'https://lucida.to';
const LUCIDA_FALLBACK = 'https://lucida.su';

export default class LucidaProvider {
  name = 'lucida';
  displayName = 'Lucida';

  async health() {
    for (const base of [LUCIDA_BASE, LUCIDA_FALLBACK]) {
      try {
        const resp = await axios.get(base, {
          timeout: 8000,
          maxRedirects: 0,
          validateStatus: (s) => s < 500,
        });
        if (resp.status === 200 || resp.status === 301 || resp.status === 302) {
          return { online: true, details: base };
        }
        return { online: false, details: `HTTP ${resp.status}` };
      } catch (e) {
        continue;
      }
    }
    return { online: false, details: 'All endpoints unreachable' };
  }

  async stream(songData) {
    const trackTitle = songData.title || 'Unknown';
    const artist = songData.author?.name || 'Unknown';
    const amazonUrl = songData.url || '';

    if (!amazonUrl) {
      throw new Error('No Amazon Music URL available for this track');
    }

    const base = await this._getWorkingBase();

    // Step 1: Get CSRF token from HTML page
    log(`Resolving track: "${trackTitle}" by ${artist}`);
    const pageResp = await axios.get(`${base}/`, {
      params: { url: amazonUrl, country: 'auto', to: 'amazon' },
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      },
    });

    const html = typeof pageResp.data === 'string' ? pageResp.data : '';
    const tokenMatch = html.match(/token:"([^"]+)"/);
    const expiryMatch = html.match(/tokenExpiry:(\d+)/);
    const urlMatch = html.match(/"url":"([^"]+)"/);

    if (!tokenMatch || !expiryMatch) {
      throw new Error('Failed to extract CSRF token from lucida.to');
    }

    // Double base64 decode
    const rawToken = tokenMatch[1];
    const decoded = Buffer.from(Buffer.from(rawToken, 'base64').toString('latin1'), 'base64').toString('latin1');
    const expiry = parseInt(expiryMatch[1], 10);
    const resolvedUrl = urlMatch ? urlMatch[1] : amazonUrl;

    // Step 2: POST /api/load to initiate download
    log('Initiating download handoff...');
    const loadResp = await axios.post(`${base}/api/load?url=/api/fetch/stream/v2`, {
      url: resolvedUrl,
      account: { id: 'auto', type: 'country' },
      compat: false,
      downscale: 'original',
      handoff: true,
      metadata: true,
      private: true,
      token: { primary: decoded, expiry },
      upload: { enabled: false },
    }, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      },
    });

    if (!loadResp.data?.success || !loadResp.data?.handoff) {
      const err = loadResp.data?.error || JSON.stringify(loadResp.data);
      throw new Error(`Lucida load failed: ${err}`);
    }

    const { server, handoff } = loadResp.data;
    const csrfCookie = loadResp.headers?.['set-cookie']?.match(/csrf_token=([^;]+)/)?.[1] || '';

    // Step 3: Poll until completed
    log(`Polling worker ${server}...`);
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusResp = await axios.get(`https://${server}.lucida.to/api/fetch/request/${handoff}`, {
        timeout: 10000,
        headers: {
          'X-CSRF-Token': csrfCookie,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        },
      });

      const status = statusResp.data?.status;
      if (status === 'completed') break;
      if (status === 'error') {
        throw new Error(`Lucida worker error: ${statusResp.data?.message || 'unknown'}`);
      }
      if (i % 5 === 4) log(`  Still processing... (${status})`);
    }

    // Step 4: Get download URL
    const downloadUrl = `https://${server}.lucida.to/api/fetch/request/${handoff}/download`;
    log(`Download ready: ${downloadUrl.substring(0, 80)}...`);

    return {
      streamUrl: downloadUrl,
      decryptionKey: null,
      quality: 'original',
      isDirectFile: true,
      headers: {
        'X-CSRF-Token': csrfCookie,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      },
    };
  }

  async _getWorkingBase() {
    for (const base of [LUCIDA_BASE, LUCIDA_FALLBACK]) {
      try {
        const resp = await axios.get(base, { timeout: 5000, maxRedirects: 0, validateStatus: () => true });
        if (resp.status < 500) return base;
      } catch { continue; }
    }
    throw new Error('No working lucida.to endpoint');
  }
}
