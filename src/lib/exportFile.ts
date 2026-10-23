// Excel export download (phase 10): the server answers with the file; the browser saves it, nothing is kept.
import { api } from './api';

export async function downloadXlsx(body: Record<string, unknown>): Promise<string> {
  const f = await api<{ file_name: string; base64: string; cases: number }>('POST', '/api/exports', body);
  const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.file_name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return f.file_name;
}
