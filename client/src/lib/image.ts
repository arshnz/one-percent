// Compress an image File into a JPEG data: URL, scaled so its longest edge is
// at most `maxDim`. Keeps canvas images small enough to store inline on the
// node (no external storage service needed) while staying sharp on screen.
export function compressImageFile(file: File, maxDim = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('No 2D context'))
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load image'))
    }
    img.src = url
  })
}

// Pull an image URL out of a drag payload coming from another browser tab.
export function imageUrlFromDataTransfer(dt: DataTransfer): string | null {
  const html = dt.getData('text/html')
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (m) return m[1]
  }
  const uri = dt.getData('text/uri-list') || dt.getData('text/plain')
  if (uri && /^https?:\/\//.test(uri.trim())) return uri.trim()
  return null
}
