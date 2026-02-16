/**
 * Attachment Service
 *
 * Handles saving, serving, and deleting file attachments for conversations.
 * Files are stored in `.my_agent/conversations/{convId}/{uuid}.{ext}`
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

export interface AttachmentMeta {
  id: string; // UUID
  filename: string; // Original filename
  localPath: string; // Relative path: {convId}/{uuid}.{ext}
  mimeType: string;
  size: number;
}

export interface SavedAttachment {
  meta: AttachmentMeta;
  absolutePath: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const ALLOWED_TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".sh",
  ".css",
  ".html",
  ".xml",
  ".csv",
  ".sql",
  ".rs",
  ".go",
  ".rb",
  ".java",
  ".c",
  ".cpp",
  ".h",
];

export class AttachmentService {
  private conversationsDir: string;

  constructor(agentDir: string) {
    this.conversationsDir = path.join(agentDir, "conversations");
  }

  /**
   * Get the attachments directory for a conversation
   */
  private getConvAttachmentsDir(conversationId: string): string {
    return path.join(this.conversationsDir, conversationId);
  }

  /**
   * Ensure the attachments directory exists for a conversation
   */
  private ensureDir(conversationId: string): void {
    const dir = this.getConvAttachmentsDir(conversationId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Check if a MIME type is allowed
   */
  isAllowedType(mimeType: string, filename: string): boolean {
    // Check image types
    if (ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      return true;
    }

    // Check text file extensions
    const ext = path.extname(filename).toLowerCase();
    if (mimeType.startsWith("text/") || ALLOWED_TEXT_EXTENSIONS.includes(ext)) {
      return true;
    }

    return false;
  }

  /**
   * Check if it's an image type
   */
  isImage(mimeType: string): boolean {
    return ALLOWED_IMAGE_TYPES.includes(mimeType);
  }

  /**
   * Validate file size
   */
  validateSize(size: number): { valid: boolean; message?: string } {
    if (size > MAX_FILE_SIZE) {
      return {
        valid: false,
        message: `File too large (${(size / 1024 / 1024).toFixed(1)}MB). Maximum size is 5MB.`,
      };
    }
    return { valid: true };
  }

  /**
   * Save an attachment from base64 data
   */
  async save(
    conversationId: string,
    filename: string,
    mimeType: string,
    base64Data: string,
  ): Promise<SavedAttachment> {
    // Decode base64 to buffer
    const buffer = Buffer.from(base64Data, "base64");
    const size = buffer.length;

    // Validate size
    const sizeCheck = this.validateSize(size);
    if (!sizeCheck.valid) {
      throw new Error(sizeCheck.message);
    }

    // Validate type
    if (!this.isAllowedType(mimeType, filename)) {
      throw new Error(`File type not allowed: ${mimeType}`);
    }

    // Generate UUID and build path
    const id = randomUUID();
    const ext = path.extname(filename) || this.getExtensionFromMime(mimeType);
    const storedFilename = `${id}${ext}`;
    const localPath = `${conversationId}/${storedFilename}`;

    // Ensure directory exists
    this.ensureDir(conversationId);

    // Write file
    const absolutePath = path.join(this.conversationsDir, localPath);
    fs.writeFileSync(absolutePath, buffer);

    const meta: AttachmentMeta = {
      id,
      filename,
      localPath,
      mimeType,
      size,
    };

    return { meta, absolutePath };
  }

  /**
   * Get file extension from MIME type
   */
  private getExtensionFromMime(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "text/plain": ".txt",
      "text/markdown": ".md",
      "application/json": ".json",
      "text/yaml": ".yaml",
      "text/javascript": ".js",
      "text/typescript": ".ts",
      "text/x-python": ".py",
    };
    return mimeToExt[mimeType] || ".bin";
  }

  /**
   * Get the absolute path to an attachment
   */
  getAbsolutePath(localPath: string): string {
    return path.join(this.conversationsDir, localPath);
  }

  /**
   * Check if an attachment exists
   */
  exists(localPath: string): boolean {
    const absolutePath = this.getAbsolutePath(localPath);
    return fs.existsSync(absolutePath);
  }

  /**
   * Read an attachment as buffer
   */
  read(localPath: string): Buffer {
    const absolutePath = this.getAbsolutePath(localPath);
    return fs.readFileSync(absolutePath);
  }

  /**
   * Delete all attachments for a conversation
   */
  deleteConversationAttachments(conversationId: string): void {
    const dir = this.getConvAttachmentsDir(conversationId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Delete a single attachment
   */
  delete(localPath: string): void {
    const absolutePath = this.getAbsolutePath(localPath);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  }
}
