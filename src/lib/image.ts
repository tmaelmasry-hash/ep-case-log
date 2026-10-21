export type ScanFilter = 'original' | 'optimized' | 'bw';

const MAX_DIM = 2000;
const THUMB_DIM = 240;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read this image file'));
    img.src = src;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

function canvasFrom(img: CanvasImageSource, w: number, h: number, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Normalises any image file to a bounded JPEG plus a thumbnail. */
export async function processFile(file: File): Promise<{ dataUrl: string; thumb: string }> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`);
  const src = await fileToDataUrl(file);
  return processDataUrl(src);
}

export async function processDataUrl(src: string): Promise<{ dataUrl: string; thumb: string }> {
  const img = await loadImage(src);
  const full = canvasFrom(img, img.naturalWidth, img.naturalHeight, MAX_DIM);
  const thumb = canvasFrom(full, full.width, full.height, THUMB_DIM);
  return { dataUrl: full.toDataURL('image/jpeg', 0.85), thumb: thumb.toDataURL('image/jpeg', 0.7) };
}

/** Rotate by a multiple of 90° clockwise. */
export async function rotate(src: string, quarterTurns: number): Promise<string> {
  const img = await loadImage(src);
  const q = ((quarterTurns % 4) + 4) % 4;
  const c = document.createElement('canvas');
  const swap = q % 2 === 1;
  c.width = swap ? img.naturalHeight : img.naturalWidth;
  c.height = swap ? img.naturalWidth : img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return c.toDataURL('image/jpeg', 0.9);
}

/** Pure pixel transform, exported for testing. Operates in place on RGBA data. */
export function applyFilterToPixels(data: Uint8ClampedArray, filter: ScanFilter): void {
  if (filter === 'original') return;
  const n = data.length / 4;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    gray[i] = g;
    hist[g]++;
  }
  if (filter === 'optimized') {
    // Percentile contrast stretch: lifts paper to white and deepens ink without hard thresholding.
    const lo = percentile(hist, n, 0.02);
    const hi = Math.max(lo + 1, percentile(hist, n, 0.9));
    for (let i = 0; i < n; i++) {
      let v = ((gray[i] - lo) / (hi - lo)) * 255;
      v = 255 * Math.pow(Math.min(1, Math.max(0, v / 255)), 1.15);
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    }
  } else {
    const t = otsu(hist, n);
    for (let i = 0; i < n; i++) {
      const v = gray[i] > t ? 255 : 0;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    }
  }
}

function percentile(hist: Uint32Array, n: number, p: number): number {
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * p) return v;
  }
  return 255;
}

export function otsu(hist: Uint32Array, n: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

export async function applyFilter(src: string, filter: ScanFilter): Promise<string> {
  if (filter === 'original') return src;
  const img = await loadImage(src);
  const c = canvasFrom(img, img.naturalWidth, img.naturalHeight, MAX_DIM);
  const ctx = c.getContext('2d')!;
  const id = ctx.getImageData(0, 0, c.width, c.height);
  applyFilterToPixels(id.data, filter);
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/jpeg', 0.88);
}
