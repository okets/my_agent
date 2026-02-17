import QRCode from "qrcode";

/**
 * Convert a Baileys QR string to a base64 data URL for display in the UI.
 */
export async function qrToDataUrl(qr: string): Promise<string> {
  return QRCode.toDataURL(qr, { width: 256, margin: 2 });
}
