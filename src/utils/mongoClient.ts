/**
 * MongoDB Client for Browser/Userscript Environment
 * 
 * This client uses HTTP/REST to communicate with MongoDB via a custom REST API.
 * Since browser environments cannot directly connect to MongoDB, you need to set up
 * a simple REST API proxy that translates HTTP requests to MongoDB operations.
 * 
 * Expected API endpoints:
 * GET    /api/{database}/{collection}?query={query}       - Find documents
 * POST   /api/{database}/{collection}                     - Insert document(s)
 * PUT    /api/{database}/{collection}?query={query}       - Update document(s)
 * DELETE /api/{database}/{collection}?query={query}       - Delete document(s)
 * GET    /api/{database}/{collection}/{id}                - Find by ID
 */

export interface MongoDocument {
  _id?: string;
  [key: string]: any;
}

export interface MongoQuery {
  [key: string]: any;
}

export interface MongoUpdate {
  $set?: { [key: string]: any };
  $unset?: { [key: string]: any };
  $inc?: { [key: string]: number };
  $push?: { [key: string]: any };
  $pull?: { [key: string]: any };
}

export interface MongoClientConfig {
  baseUrl: string;
  database: string;
  username?: string;
  password?: string;
  timeout?: number;
}

class MongoClient {
  private config: MongoClientConfig;
  private authHeader: string;

  constructor(config: MongoClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };

    // Create basic auth header if credentials provided
    if (config.username && config.password) {
      const credentials = btoa(`${config.username}:${config.password}`);
      this.authHeader = `Basic ${credentials}`;
    } else {
      this.authHeader = '';
    }
  }

  private async request(
    method: string,
    path: string,
    body?: any,
    queryParams?: Record<string, string>,
  ): Promise<any> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    
    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`MongoDB HTTP Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('MongoDB request timeout');
      }
      throw error;
    }
  }

  /**
   * Get a collection instance
   */
  collection(name: string): MongoCollection {
    return new MongoCollection(this, this.config.database, name);
  }

  /**
   * Test connection to MongoDB
   */
  async ping(): Promise<boolean> {
    try {
      await this.request('GET', `/api/${this.config.database}/_ping`);
      return true;
    } catch (error) {
      con.error('MongoDB ping failed:', error);
      return false;
    }
  }

  /**
   * Internal request method used by collections
   */
  async _makeRequest(
    method: string,
    database: string,
    collection: string,
    options: {
      query?: MongoQuery;
      body?: any;
      id?: string;
    } = {},
  ): Promise<any> {
    let path = `/api/${database}/${collection}`;
    const queryParams: Record<string, string> = {};

    if (options.id) {
      path += `/${options.id}`;
    }

    if (options.query) {
      queryParams.query = JSON.stringify(options.query);
    }

    return this.request(method, path, options.body, queryParams);
  }
}

class MongoCollection {
  constructor(
    private client: MongoClient,
    private database: string,
    private collectionName: string,
  ) {}

  /**
   * Find documents matching query
   */
  async find(query: MongoQuery = {}): Promise<MongoDocument[]> {
    const result = await this.client._makeRequest('GET', this.database, this.collectionName, {
      query,
    });
    return result.documents || [];
  }

  /**
   * Find one document matching query
   */
  async findOne(query: MongoQuery): Promise<MongoDocument | null> {
    const results = await this.find(query);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Find document by ID
   */
  async findById(id: string): Promise<MongoDocument | null> {
    try {
      const result = await this.client._makeRequest('GET', this.database, this.collectionName, {
        id,
      });
      return result.document || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Insert one document
   */
  async insertOne(document: MongoDocument): Promise<{ insertedId: string }> {
    const result = await this.client._makeRequest('POST', this.database, this.collectionName, {
      body: document,
    });
    return { insertedId: result.insertedId };
  }

  /**
   * Insert multiple documents
   */
  async insertMany(documents: MongoDocument[]): Promise<{ insertedIds: string[] }> {
    const result = await this.client._makeRequest('POST', this.database, this.collectionName, {
      body: { documents },
    });
    return { insertedIds: result.insertedIds || [] };
  }

  /**
   * Update documents matching query
   */
  async updateMany(query: MongoQuery, update: MongoUpdate): Promise<{ modifiedCount: number }> {
    const result = await this.client._makeRequest('PUT', this.database, this.collectionName, {
      query,
      body: update,
    });
    return { modifiedCount: result.modifiedCount || 0 };
  }

  /**
   * Update one document matching query
   */
  async updateOne(query: MongoQuery, update: MongoUpdate): Promise<{ modifiedCount: number }> {
    return this.updateMany(query, update);
  }

  /**
   * Replace or insert document (upsert)
   */
  async replaceOne(
    query: MongoQuery,
    document: MongoDocument,
    upsert = true,
  ): Promise<{ modifiedCount: number; upsertedId?: string }> {
    const result = await this.client._makeRequest('PUT', this.database, this.collectionName, {
      query,
      body: { document, upsert },
    });
    return {
      modifiedCount: result.modifiedCount || 0,
      upsertedId: result.upsertedId,
    };
  }

  /**
   * Delete documents matching query
   */
  async deleteMany(query: MongoQuery): Promise<{ deletedCount: number }> {
    const result = await this.client._makeRequest('DELETE', this.database, this.collectionName, {
      query,
    });
    return { deletedCount: result.deletedCount || 0 };
  }

  /**
   * Delete one document matching query
   */
  async deleteOne(query: MongoQuery): Promise<{ deletedCount: number }> {
    return this.deleteMany(query);
  }

  /**
   * Count documents matching query
   */
  async countDocuments(query: MongoQuery = {}): Promise<number> {
    const result = await this.client._makeRequest('GET', this.database, this.collectionName, {
      query: { ...query, _count: true },
    });
    return result.count || 0;
  }

  /**
   * Clear all documents in collection
   */
  async clear(): Promise<{ deletedCount: number }> {
    return this.deleteMany({});
  }

  /**
   * Bulk insert or update (put) documents
   */
  async bulkPut(documents: MongoDocument[]): Promise<void> {
    await this.client._makeRequest('POST', this.database, this.collectionName, {
      body: { documents, upsert: true },
    });
  }
}

/**
 * Create MongoDB client instance
 */
export function createMongoClient(config: MongoClientConfig): MongoClient {
  return new MongoClient(config);
}

export { MongoClient, MongoCollection };
