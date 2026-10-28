/**
 * Client-side image compression to optimize upload speed & minimize Odoo storage
 */
export function compressImage(dataUrl, maxWidth = 1280, quality = 0.78) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Formats raw base64 or data URI into a displayable img src
 */
export function formatImagePreviewSrc(gambarQc) {
  if (!gambarQc) return null;
  return gambarQc.startsWith('data:') ? gambarQc : `data:image/jpeg;base64,${gambarQc}`;
}

