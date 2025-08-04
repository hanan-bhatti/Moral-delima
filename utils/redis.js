// utils/redis.js
const logger = require('../config/logger');

class RedisHelper {
  constructor(client) {
    this.client = client;
    this.isEnabled = client && client.isReady;
  }

  /**
   * Get value from Redis with error handling
   * @param {string} key - Redis key
   * @param {boolean} parseJson - Whether to parse as JSON
   * @returns {Promise<any>} - Cached value or null
   */
  async get(key, parseJson = true) {
    if (!this.isEnabled) return null;

    const startTime = Date.now();
    try {
      const value = await this.client.get(key);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('GET', key, duration);
      
      if (value === null) return null;
      return parseJson ? JSON.parse(value) : value;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('GET', key, duration, error);
      return null;
    }
  }

  /**
   * Set value in Redis with error handling
   * @param {string} key - Redis key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @param {boolean} stringify - Whether to stringify value
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, ttl = 3600, stringify = true) {
    if (!this.isEnabled) return false;

    const startTime = Date.now();
    try {
      const serializedValue = stringify ? JSON.stringify(value) : value;
      await this.client.setEx(key, ttl, serializedValue);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('SET', key, duration);
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('SET', key, duration, error);
      return false;
    }
  }

  /**
   * Delete key from Redis
   * @param {string} key - Redis key to delete
   * @returns {Promise<boolean>} - Success status
   */
  async del(key) {
    if (!this.isEnabled) return false;

    const startTime = Date.now();
    try {
      await this.client.del(key);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('DEL', key, duration);
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('DEL', key, duration, error);
      return false;
    }
  }

  /**
   * Check if key exists in Redis
   * @param {string} key - Redis key
   * @returns {Promise<boolean>} - Whether key exists
   */
  async exists(key) {
    if (!this.isEnabled) return false;

    const startTime = Date.now();
    try {
      const exists = await this.client.exists(key);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('EXISTS', key, duration);
      return exists === 1;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('EXISTS', key, duration, error);
      return false;
    }
  }

  /**
   * Set expiration for a key
   * @param {string} key - Redis key
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} - Success status
   */
  async expire(key, ttl) {
    if (!this.isEnabled) return false;

    const startTime = Date.now();
    try {
      await this.client.expire(key, ttl);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('EXPIRE', key, duration);
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('EXPIRE', key, duration, error);
      return false;
    }
  }

  /**
   * Get multiple keys at once
   * @param {string[]} keys - Array of Redis keys
   * @param {boolean} parseJson - Whether to parse as JSON
   * @returns {Promise<Object>} - Object with key-value pairs
   */
  async mget(keys, parseJson = true) {
    if (!this.isEnabled || !keys.length) return {};

    const startTime = Date.now();
    try {
      const values = await this.client.mGet(keys);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('MGET', `[${keys.join(', ')}]`, duration);
      
      const result = {};
      keys.forEach((key, index) => {
        const value = values[index];
        if (value !== null) {
          result[key] = parseJson ? JSON.parse(value) : value;
        }
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('MGET', `[${keys.join(', ')}]`, duration, error);
      return {};
    }
  }

  /**
   * Increment a key's value
   * @param {string} key - Redis key
   * @param {number} amount - Amount to increment by
   * @returns {Promise<number>} - New value or 0 on error
   */
  async incr(key, amount = 1) {
    if (!this.isEnabled) return 0;

    const startTime = Date.now();
    try {
      const newValue = amount === 1 
        ? await this.client.incr(key)
        : await this.client.incrBy(key, amount);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('INCR', key, duration);
      return newValue;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('INCR', key, duration, error);
      return 0;
    }
  }

  /**
   * Add item to a Redis set
   * @param {string} key - Redis key
   * @param {string|string[]} members - Member(s) to add
   * @returns {Promise<boolean>} - Success status
   */
  async sadd(key, members) {
    if (!this.isEnabled) return false;

    const startTime = Date.now();
    try {
      await this.client.sAdd(key, members);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('SADD', key, duration);
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('SADD', key, duration, error);
      return false;
    }
  }

  /**
   * Get all members of a Redis set
   * @param {string} key - Redis key
   * @returns {Promise<string[]>} - Set members
   */
  async smembers(key) {
    if (!this.isEnabled) return [];

    const startTime = Date.now();
    try {
      const members = await this.client.sMembers(key);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('SMEMBERS', key, duration);
      return members;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('SMEMBERS', key, duration, error);
      return [];
    }
  }

  /**
   * Add item to a Redis list (left push)
   * @param {string} key - Redis key
   * @param {string|string[]} values - Value(s) to add
   * @returns {Promise<boolean>} - Success status
   */
  async lpush(key, values) {
    if (!this.isEnabled) return false;

    const startTime = Date.now();
    try {
      await this.client.lPush(key, values);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('LPUSH', key, duration);
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('LPUSH', key, duration, error);
      return false;
    }
  }

  /**
   * Get range of items from Redis list
   * @param {string} key - Redis key
   * @param {number} start - Start index
   * @param {number} stop - Stop index
   * @returns {Promise<string[]>} - List items
   */
  async lrange(key, start = 0, stop = -1) {
    if (!this.isEnabled) return [];

    const startTime = Date.now();
    try {
      const items = await this.client.lRange(key, start, stop);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('LRANGE', key, duration);
      return items;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('LRANGE', key, duration, error);
      return [];
    }
  }

  /**
   * Cache with fallback function
   * @param {string} key - Cache key
   * @param {Function} fallbackFn - Function to call if cache miss
   * @param {number} ttl - Time to live in seconds
   * @param {boolean} parseJson - Whether to parse cached value as JSON
   * @returns {Promise<any>} - Cached or computed value
   */
  async getOrSet(key, fallbackFn, ttl = 3600, parseJson = true) {
    // Try to get from cache first
    const cached = await this.get(key, parseJson);
    if (cached !== null) {
      logger.debug(`Cache hit for key: ${key}`);
      return cached;
    }

    // Cache miss - compute value
    logger.debug(`Cache miss for key: ${key}`);
    try {
      const value = await fallbackFn();
      
      // Cache the result
      await this.set(key, value, ttl, parseJson);
      
      return value;
    } catch (error) {
      logger.error(`Error in fallback function for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Invalidate cache with pattern
   * @param {string} pattern - Redis key pattern
   * @returns {Promise<number>} - Number of keys deleted
   */
  async invalidatePattern(pattern) {
    if (!this.isEnabled) return 0;

    const startTime = Date.now();
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;

      await this.client.del(keys);
      const duration = Date.now() - startTime;
      
      logger.logRedisOperation('DEL_PATTERN', pattern, duration);
      logger.info(`Invalidated ${keys.length} cache keys matching pattern: ${pattern}`);
      
      return keys.length;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logRedisOperation('DEL_PATTERN', pattern, duration, error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} - Cache statistics
   */
  async getStats() {
    if (!this.isEnabled) {
      return { enabled: false };
    }

    try {
      const info = await this.client.info('memory');
      const keyspace = await this.client.info('keyspace');
      
      return {
        enabled: true,
        connected: this.client.isReady,
        memory: info,
        keyspace: keyspace
      };
    } catch (error) {
      logger.error('Error getting Redis stats:', error);
      return { enabled: true, connected: false, error: error.message };
    }
  }

  /**
   * Warm up cache with initial data
   * @param {Object} initialData - Object with key-value pairs to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} - Success status
   */
  async warmUp(initialData, ttl = 3600) {
    if (!this.isEnabled || !initialData) return false;

    logger.info('Warming up cache with initial data...');
    
    try {
      const promises = Object.entries(initialData).map(([key, value]) =>
        this.set(key, value, ttl)
      );
      
      await Promise.all(promises);
      logger.info(`Cache warmed up with ${Object.keys(initialData).length} keys`);
      return true;
    } catch (error) {
      logger.error('Error warming up cache:', error);
      return false;
    }
  }
}

module.exports = RedisHelper;