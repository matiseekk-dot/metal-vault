// ── Photo compression — client-side, Canvas API ──────────────
//
// Phone cameras output 5-12 MB per photo. We don't need that for sleeve
// photos — 1600px on the long edge at JPEG q=0.8 = ~300-500 KB, sharp
// enough for insurance evidence and visual identification.
//
// Returns base64 data URL ready to POST to /api/collection/photos.

const MAX_DIMENSION = 1600;   // longest edge in px
const QUALITY = 0.82;         // JPEG quality (0-1)

export function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !(file instanceof Blob)) {
      reject(new Error('Invalid file'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        try {
          // Compute target dimensions — preserve aspect ratio
          let { width, height } = img;
          if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            if (width >= height) {
              height = Math.round((height / width) * MAX_DIMENSION);
              width = MAX_DIMENSION;
            } else {
              width = Math.round((width / height) * MAX_DIMENSION);
              height = MAX_DIMENSION;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // toDataURL is sync but blocks main thread on huge images — OK for our sizes
          const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);

          // Sanity check
          if (!dataUrl.startsWith('data:image/jpeg;base64,')) {
            reject(new Error('Compression produced invalid output'));
            return;
          }

          // Return base64 + estimated size for caller's UI feedback
          const base64 = dataUrl.split(',')[1];
          const estimatedBytes = Math.round((base64.length * 3) / 4);

          resolve({
            dataUrl,
            base64,
            mime: 'image/jpeg',
            width,
            height,
            sizeBytes: estimatedBytes,
          });
        } catch (e) {
          reject(e);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Helper for size display in UI
export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
