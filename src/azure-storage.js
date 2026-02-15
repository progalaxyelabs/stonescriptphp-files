import { BlobServiceClient } from '@azure/storage-blob';
import { v4 as uuidv4 } from 'uuid';

/**
 * Azure Blob Storage operations
 * Handles upload, download, list, and delete operations
 */
export class AzureStorageClient {
  constructor(connectionString, containerName = 'platform-files') {
    this.connectionString = connectionString;
    this.containerName = containerName;
    this.blobServiceClient = null;
    this.containerClient = null;
    this.isConfigured = !!connectionString;
  }

  /**
   * Initialize Azure Blob Storage client
   */
  async initialize() {
    if (!this.isConfigured) {
      console.warn('⚠️  AZURE_STORAGE_CONNECTION_STRING not set — file uploads will fail');
      return;
    }

    try {
      // Create BlobServiceClient
      this.blobServiceClient = BlobServiceClient.fromConnectionString(this.connectionString);

      // Get container client
      this.containerClient = this.blobServiceClient.getContainerClient(this.containerName);

      // Create container if it doesn't exist (no access property = private, no public access)
      await this.containerClient.createIfNotExists();

      console.log(`Azure Blob Storage initialized: container=${this.containerName}`);
    } catch (error) {
      console.error('Failed to initialize Azure Blob Storage:', error);
      throw error;
    }
  }

  /**
   * Upload file to Azure Blob Storage
   * @param {string} tenantId - Tenant ID (for multi-tenant namespacing)
   * @param {string} userId - User ID (for namespacing)
   * @param {Buffer} fileBuffer - File content
   * @param {string} originalFilename - Original filename
   * @param {string} contentType - MIME type
   * @param {string} scope - Storage scope: 'user' (default) or 'tenant'
   * @returns {Object} File metadata
   */
  async uploadFile(tenantId, userId, fileBuffer, originalFilename, contentType, scope = 'user') {
    if (!this.isConfigured) {
      const error = new Error('Storage not configured');
      error.statusCode = 503;
      throw error;
    }

    if (!this.containerClient) {
      throw new Error('Azure Storage not initialized');
    }

    // Generate unique blob name with scope-based prefix
    const fileId = uuidv4();
    const extension = originalFilename.split('.').pop();
    let prefix;
    if (scope === 'tenant') {
      prefix = tenantId ? `${tenantId}/shared/` : 'shared/';
    } else {
      prefix = tenantId ? `${tenantId}/${userId}/` : `${userId}/`;
    }
    const blobName = `${prefix}${fileId}.${extension}`;

    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    // Upload with metadata
    await blockBlobClient.upload(fileBuffer, fileBuffer.length, {
      blobHTTPHeaders: {
        blobContentType: contentType
      },
      metadata: {
        tenant_id: tenantId || '',
        user_id: userId,
        original_filename: originalFilename,
        content_type: contentType,
        uploaded_at: new Date().toISOString(),
        file_id: fileId,
        scope: scope
      }
    });

    return {
      fileId,
      blobName,
      tenantId,
      userId,
      originalFilename,
      contentType,
      size: fileBuffer.length,
      uploadedAt: new Date().toISOString()
    };
  }

  /**
   * Download file from Azure Blob Storage
   * @param {string} fileId - File ID (UUID)
   * @param {string} tenantId - Tenant ID (for multi-tenant namespacing)
   * @param {string} userId - User ID (for authorization)
   * @param {string} scope - Storage scope: 'user' (default) or 'tenant'
   * @returns {Object} { stream, metadata }
   */
  async downloadFile(fileId, tenantId, userId, scope = 'user') {
    if (!this.isConfigured) {
      const error = new Error('Storage not configured');
      error.statusCode = 503;
      throw error;
    }

    if (!this.containerClient) {
      throw new Error('Azure Storage not initialized');
    }

    // Build prefix based on scope
    let prefix;
    if (scope === 'tenant') {
      prefix = tenantId ? `${tenantId}/shared/` : 'shared/';
    } else {
      prefix = tenantId ? `${tenantId}/${userId}/` : `${userId}/`;
    }

    const blobs = this.containerClient.listBlobsFlat({
      prefix,
      includeMetadata: true
    });

    for await (const blob of blobs) {
      if (blob.metadata && blob.metadata.file_id === fileId) {
        const blockBlobClient = this.containerClient.getBlockBlobClient(blob.name);

        // Verify ownership for user-scoped files only
        // Tenant-scoped files are shared — authorization middleware already checked access
        if (scope === 'user' && blob.metadata.user_id !== userId) {
          throw new Error('Unauthorized: File belongs to different user');
        }

        // Download blob
        const downloadResponse = await blockBlobClient.download(0);

        return {
          stream: downloadResponse.readableStreamBody,
          metadata: {
            fileName: blob.metadata.original_filename,
            contentType: blob.metadata.content_type,
            size: blob.properties.contentLength
          }
        };
      }
    }

    throw new Error('File not found');
  }

  /**
   * List user's files
   * @param {string} tenantId - Tenant ID (for multi-tenant namespacing)
   * @param {string} userId - User ID
   * @param {string} scope - Storage scope: 'user' (default) or 'tenant'
   * @returns {Array} List of file metadata
   */
  async listFiles(tenantId, userId, scope = 'user') {
    if (!this.isConfigured) {
      const error = new Error('Storage not configured');
      error.statusCode = 503;
      throw error;
    }

    if (!this.containerClient) {
      throw new Error('Azure Storage not initialized');
    }

    const files = [];
    let prefix;
    if (scope === 'tenant') {
      prefix = tenantId ? `${tenantId}/shared/` : 'shared/';
    } else {
      prefix = tenantId ? `${tenantId}/${userId}/` : `${userId}/`;
    }
    const blobs = this.containerClient.listBlobsFlat({
      prefix,
      includeMetadata: true
    });

    for await (const blob of blobs) {
      if (blob.metadata) {
        files.push({
          fileId: blob.metadata.file_id,
          fileName: blob.metadata.original_filename,
          contentType: blob.metadata.content_type,
          size: blob.properties.contentLength,
          uploadedAt: blob.metadata.uploaded_at
        });
      }
    }

    return files;
  }

  /**
   * Delete file from Azure Blob Storage
   * @param {string} fileId - File ID (UUID)
   * @param {string} tenantId - Tenant ID (for multi-tenant namespacing)
   * @param {string} userId - User ID (for authorization)
   * @param {string} scope - Storage scope: 'user' (default) or 'tenant'
   */
  async deleteFile(fileId, tenantId, userId, scope = 'user') {
    if (!this.isConfigured) {
      const error = new Error('Storage not configured');
      error.statusCode = 503;
      throw error;
    }

    if (!this.containerClient) {
      throw new Error('Azure Storage not initialized');
    }

    // Find blob by file_id with scope-based prefix
    let prefix;
    if (scope === 'tenant') {
      prefix = tenantId ? `${tenantId}/shared/` : 'shared/';
    } else {
      prefix = tenantId ? `${tenantId}/${userId}/` : `${userId}/`;
    }

    const blobs = this.containerClient.listBlobsFlat({
      prefix,
      includeMetadata: true
    });

    for await (const blob of blobs) {
      if (blob.metadata && blob.metadata.file_id === fileId) {
        // Verify ownership for user-scoped files only
        if (scope === 'user' && blob.metadata.user_id !== userId) {
          throw new Error('Unauthorized: File belongs to different user');
        }

        const blockBlobClient = this.containerClient.getBlockBlobClient(blob.name);
        await blockBlobClient.delete();
        return;
      }
    }

    throw new Error('File not found');
  }

  /**
   * Get container client (for advanced operations)
   */
  getContainerClient() {
    return this.containerClient;
  }
}
