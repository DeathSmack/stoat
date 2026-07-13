import axios from 'axios';

const log = (msg) => console.log(`[DoubledoubleProvider] ${msg}`);

const REGIONS = [
  { name: 'us', base: 'https://us.doubledouble.top' },
  { name: 'eu', base: 'https://eu.doubledouble.top' },
];

export default class DoubledoubleProvider {
  name = 'doubledouble';
  displayName = 'DoubleDouble';

  async health() {
    for (const region of REGIONS) {
      try {
        const resp = await axios.get(region.base, { timeout: 8000, maxRedirects: 0, validateStatus: (s) => s < 500 });
        if (resp.status === 200) {
          return { online: true, details: region.name };
        }
        return { online: false, details: `HTTP ${resp.status} (${region.name})` };
      } catch { continue; }
    }
    return { online: false, details: 'All regions unreachable' };
  }

  async stream(songData) {
    const amazonUrl = songData.url || '';
    if (!amazonUrl) {
      throw new Error('No Amazon Music URL available for this track');
    }

    const region = await this._getWorkingRegion();
    const base = region.base;

    // Step 1: Initiate download
    log(`Initiating download via ${region.name}...`);
    const initResp = await axios.get(`${base}/dl`, {
      params: { url: amazonUrl, format: 'flac', donotshare: 'true' },
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Referer': base,
      },
    });

    if (!initResp.data?.success) {
      const err = initResp.data?.error || JSON.stringify(initResp.data);
      throw new Error(`DoubleDouble init failed: ${err}`);
    }

    const { id } = initResp.data;

    // Step 2: Poll until done
    log(`Polling download ${id}...`);
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusResp = await axios.get(`${base}/dl/${id}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
          'Referer': base,
        },
      });

      const status = statusResp.data?.status;
      if (status === 'done') {
        const fileUrl = new URL(statusResp.data.url, base).href;
        log(`Download ready: ${fileUrl.substring(0, 80)}...`);
        return {
          streamUrl: fileUrl,
          decryptionKey: null,
          quality: 'original',
          isDirectFile: true,
        };
      }
      if (status === 'error') {
        throw new Error(`DoubleDouble error: ${statusResp.data?.message || 'unknown'}`);
      }
      if (i % 5 === 4) log(`  Still processing... (${status} ${statusResp.data?.percent || ''}%)`);
    }

    throw new Error('DoubleDouble download timed out');
  }

  async _getWorkingRegion() {
    for (const region of REGIONS) {
      try {
        const resp = await axios.get(region.base, { timeout: 5000, maxRedirects: 0, validateStatus: () => true });
        if (resp.status === 200) return region;
      } catch { continue; }
    }
    throw new Error('No working DoubleDouble region');
  }
}
