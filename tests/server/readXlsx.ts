// Test helper: reads back the .xlsx files this app writes (stored zip entries; inline strings; numbers; booleans)
// and the files the fake Apps Script makes. Not a general xlsx reader.
export function readXlsx(base64: string): Record<string, (string | number | boolean | null)[][]> {
  const b = Uint8Array.from(Buffer.from(base64, 'base64'));
  const dv = new DataView(b.buffer);
  const files = new Map<string, string>();
  let i = 0;
  while (i + 30 <= b.length && dv.getUint32(i, true) === 0x04034b50) {
    const size = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extra = dv.getUint16(i + 28, true);
    const name = new TextDecoder().decode(b.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    files.set(name, new TextDecoder().decode(b.subarray(start, start + size)));
    i = start + size;
  }
  const wb = files.get('xl/workbook.xml') ?? '';
  const names = [...wb.matchAll(/<sheet name="([^"]*)" sheetId="(\d+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const out: Record<string, (string | number | boolean | null)[][]> = {};
  names.forEach((n, k) => {
    const xml = files.get(`xl/worksheets/sheet${k + 1}.xml`) ?? '';
    const rows: (string | number | boolean | null)[][] = [];
    for (const r of xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)) {
      const row: (string | number | boolean | null)[] = [];
      for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/g)) {
        let col = 0;
        for (const ch of c[1]) col = col * 26 + ch.charCodeAt(0) - 64;
        const t = /t="(\w+)"/.exec(c[2])?.[1];
        const v = t === 'inlineStr' ? unesc(/<t[^>]*>(.*?)<\/t>/s.exec(c[3])?.[1] ?? '') : /<v>(.*?)<\/v>/.exec(c[3])?.[1] ?? null;
        row[col - 1] = t === 'b' ? v === '1' : t === 'inlineStr' ? v : v === null ? null : Number(v);
      }
      rows[Number(r[1]) - 1] = Array.from(row, (x) => x ?? null);
    }
    out[n] = rows;
  });
  return out;
}
