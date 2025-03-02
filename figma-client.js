import fetch from 'node-fetch';

class FigmaClient {
  constructor(personalAccessToken, verbose = false) {
    this.personalAccessToken = personalAccessToken;
    this.baseURL = 'https://api.figma.com/v1';
    this.verbose = verbose;
  }

  // Helper for conditional logging based on verbose flag
  log(...args) {
    if (this.verbose) {
      console.log(...args);
    }
  }

  async request(endpoint) {
    const url = `${this.baseURL}${endpoint}`;
    this.log(`Making API request to: ${url}`);
    
    try {
      const response = await fetch(url, {
        headers: {
          'X-Figma-Token': this.personalAccessToken
        }
      });

      this.log(`Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        let errorText;
        try {
          const error = await response.json();
          errorText = `${error.status} ${error.err || response.statusText}`;
        } catch (e) {
          errorText = `${response.status} ${response.statusText}`;
        }
        throw new Error(`Figma API Error: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (error.message.includes('Figma API Error')) {
        throw error;
      }
      throw new Error(`Network error: ${error.message}`);
    }
  }

  async file(fileKey) {
    return this.request(`/files/${fileKey}`);
  }

  async fileNodes(fileKey, nodeIds) {
    const nodeIdsParam = Array.isArray(nodeIds) ? nodeIds.join(',') : nodeIds;
    return this.request(`/files/${fileKey}/nodes?ids=${nodeIdsParam}`);
  }

  async comments(fileKey) {
    return this.request(`/files/${fileKey}/comments`);
  }

  async images(fileKey, options = {}) {
    const { ids, scale = 1, format = 'png' } = options;
    const idsParam = Array.isArray(ids) ? ids.join(',') : ids;
    return this.request(`/images/${fileKey}?ids=${idsParam}&scale=${scale}&format=${format}`);
  }
}

export default FigmaClient;