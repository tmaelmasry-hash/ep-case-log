// Excel export download (phase 10): the server answers with the file; the browser saves it, nothing is kept.
import { api } from './api';
import { buildXlsx, type XCell } from '../../shared/xlsx.ts';

function save(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadXlsx(body: Record<string, unknown>, path = '/api/exports'): Promise<string> {
  const f = await api<{ file_name: string; base64: string }>('POST', path, body);
  save(
    Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
    f.file_name,
  );
  return f.file_name;
}

/** One dashboard table as its own small Excel file (owner, step 7), built in the browser: counts only, no MRNs. */
export function downloadTable(title: string, rows: XCell[][]): string {
  const name = `KAMC_EP_Registry_${title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}.xlsx`;
  save(buildXlsx([{ name: title.slice(0, 31), rows }]), name);
  return name;
}
