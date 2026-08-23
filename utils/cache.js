class Cache {
  constructor() {
    this.store = new Map();
  }

  set(key, value, ttlSeconds = 300) { // Default TTL: 5 minutes
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt });
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return item.value;
  }

  del(key) {
    this.store.delete(key);
  }

  flush() {
    this.store.clear();
  }
}

// Export as a singleton so it shares memory across controllers
module.exports = new Cache();
