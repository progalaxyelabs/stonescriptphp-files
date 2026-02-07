import { BlobServiceClient } from '@azure/storage-blob';
import { v4 as uuidv4 } from 'uuid';

/**
 * Azure Blob Storage operations
 * Handles upload, download, list, and delete operations
 */
export class AzureStorageClient {
  constructor(connectionString, containerName = 'platform-files') {
    if (!connectionString) {
      throw new Error('Azure Storage connection string is required');
    }

    this.connectionString = connectionString;
    this.containerName = containerName;
    this.blobServiceClient = null;
    this.containerClient = null;
  }

  /**
   * Initialize Azure Blob Storage client
   */
  async initialize() {
    try {
      // Create BlobServiceClient
      this.blobServiceClient = BlobServiceClient.fromConnectionString(this.connectionString);

      // Get container client
      this.containerClient = this.blobServiceClient.getContainerClient(this.containerName);

      // Create container if it doesn't exist
      await this.containerClient.createIfNotExists({
        access: 'private' // CRITICAL: No public access
      });

      console.log(`Azure Blob Storage initialized: container=${this.containerName}`);
    } catch (error) {
      console.error('Failed to initialize Azure Blob Storage:', error);
      throw error;
    }
  }

  /**
   * Upload file to Azure Blob Storage
   * @param {string} userId - User ID (for namespacing)
   * @param {Buffer} fileBuffer - File content
   * @param {string} originalFilename - Original filename
   * @param {string} contentType - MIME type
   * @returns {Object} File metadata
   */
  async uploadFile(userId, fileBuffer, originalFilename, contentType) {
    if (!this.containerClient) {
      throw new Error('Azure Storage not initialized');
    }

    // Generate unique blob name: {user_id}/{uuid}.{ext}
    const fileId = uuidv4();
    const extension = originalFilename.split('.').pop();
    const blobName = `${userId}/${fileId}.${extension}`;

    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    // Upload with metadata
    await blockBlobClient.upload(fileBuffer, fileBuffer.length, {
      blobHTTPHeaders: {
        blobContentType: contentType
      },
      metadata: {
        user_id: userId,
        original_filename: originalFilename,
        content_type: contentType,
        uploaded_at: new Date().toISOString(),
        file_id: fileId
      }
    });

    return {
      fileId,
      blobName,
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
   * @param {string} userId - User ID (for authorization)
   * @returns {Object} { stream, metadata }
   */
  async downloadFile(fileId, userId) {
    if (!this.containerClient) {
      throw new Error('Azure Storage not initialized');
    }

    // List blobs with file_id metadata to find the blob
    const blobs = this.containerClient.listBlobsFlat({
      prefix: `${userId}/`,
      includeMetadata: true
    });

    for await (const blob of blobs) {
      if (blob.metadata && blob.metadata.file_id === fileId) {
        const blockBlobClient = this.containerClient.getBlockBlobClient(blob.name);

        // Verify ownership
        if (blob.metadata.user_id !== userId) {
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
   * @param {string} userId - User ID
   * @returns {Array} List of file metadata
   */
  async listFiles(userId) {
    if (!this.containerClient) {
      throw new Error('Azure Storage not initialized');
    }

    const files = [];
    const blobs = this.containerClient.listBlobsFlat({
      prefix: `${userId}/`,
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
   * @param {string} userId - User ID (for authorization)
   */
  async deleteFile(fileId, userId) {
    if (!this.containerClient) {
      throw new Error('Azure Storage not initialized');
    }

    // Find blob by file_id
    const blobs = this.containerClient.listBlobsFlat({
      prefix: `${userId}/`,
      includeMetadata: true
    });

    for await (const blob of blobs) {
      if (blob.metadata && blob.metadata.file_id === fileId) {
        // Verify ownership
        if (blob.metadata.user_id !== userId) {
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
