import QRCode from "qrcode";

/**
 * The QRIS payload as a PNG data URL for /checkout/sukses, or null. Shared by the order API and the
 * retry API so the two instructions a shopper can be shown are drawn the same way. Never throws: it
 * runs after the bill exists, and a picture is not worth failing a payment over (the page falls back
 * to the copyable payload).
 */
export async function qrImageDataUrl(payload: string | null | undefined, orderNumber: string): Promise<string | null> {
  if (!payload) return null;
  try {
    return await QRCode.toDataURL(payload, { margin: 4, width: 320, errorCorrectionLevel: "M" });
  } catch (error) {
    console.error("[pay] QRIS image generation failed for", orderNumber, error);
    return null;
  }
}
