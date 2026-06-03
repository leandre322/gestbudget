export function serial(obj: any): any {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serial);
  if (obj && typeof obj === 'object') {
    const r: any = {};
    for (const k of Object.keys(obj)) r[k] = serial(obj[k]);
    return r;
  }
  return obj;
}

export function toNum(v: any): number {
  return typeof v === 'bigint' ? Number(v) : (Number(v) || 0);
}