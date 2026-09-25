/**
 * Client-side image compression for proof screenshots (ported from the
 * reference app's adda-ludo/utils/compressImage.js).
 *
 * Phone screenshots are routinely 2-5 MB; the upload endpoint caps at 8 MB and
 * the admin panel only needs enough detail to verify a Ludo result. Anything
 * already under `maxSizeKB` is returned untouched; bigger files are drawn to a
 * canvas (bounded to maxWidth/maxHeight) and re-encoded as JPEG, stepping the
 * quality down until the result fits.
 */
export default function compressImage(
  file,
  { maxWidth = 1200, maxHeight = 1200, quality = 0.7, maxSizeKB = 800 } = {}
) {
  return new Promise((resolve, reject) => {
    if (!file.type?.startsWith("image/")) {
      reject(new Error("Only image files are allowed"));
      return;
    }

    // already small enough — skip the canvas round-trip
    if (file.size <= maxSizeKB * 1024) {
      resolve(file);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);

        const minQuality = 0.3;
        const step = 0.1;
        const tryCompress = (q) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(file); // canvas failed — fall back to the original
                return;
              }
              if (blob.size > maxSizeKB * 1024 && q > minQuality) {
                tryCompress(Number((q - step).toFixed(2)));
              } else {
                resolve(
                  new File([blob], (file.name || "proof").replace(/\.\w+$/, "") + ".jpg", {
                    type: "image/jpeg",
                    lastModified: Date.now(),
                  })
                );
              }
            },
            "image/jpeg",
            q
          );
        };
        tryCompress(quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
