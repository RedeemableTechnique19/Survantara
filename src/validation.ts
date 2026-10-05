import { HttpError } from './http';

/** Trim and length-cap a single-line value, collapsing runs of whitespace to one space. */
export const clean = (value: unknown, max = 2000): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Length-cap a free-text value while preserving paragraph breaks. Used for
 * descriptions and notes, where collapsing newlines would destroy meaning.
 * Output is escaped at render time, so no character stripping happens here.
 */
export const multiline = (value: unknown, max = 2000): string =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
    .slice(0, max);

export const bool = (value: unknown): boolean =>
  value === true || value === 1 || String(value).toLowerCase() === 'true';

/** Validate a bounded list of master-data codes supplied by a multi-select UI. */
export function codeList(value: unknown, label: string, max = 24): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(`${label} tidak valid.`);
  const result = [...new Set(value.map((item) => clean(item, 50)).filter(Boolean))];
  if (result.length > max || result.some((code) => !/^[A-Z0-9_]+$/.test(code)))
    throw new HttpError(`${label} tidak valid.`);
  return result;
}

export function integer(value: unknown, label: string): number {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(`${label} harus berupa bilangan bulat nol atau lebih.`);
  return n;
}

export function date(value: unknown): string | null {
  const text = clean(value, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new HttpError('Tanggal tidak valid.');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text)
    throw new HttpError('Tanggal tidak valid.');
  if (parsed.getTime() > Date.now() + 86400000)
    throw new HttpError('Tanggal kejadian tidak masuk akal.');
  return text;
}

/** Escapes LIKE wildcards so a user query treats % and _ as literal characters. */
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type Priority = 'TINGGI' | 'SEDANG' | 'RENDAH';
type TriageResult = { priority: Priority; reason: string; version: string };
export type StructuredTriageOptions = {
  eventType: string;
  basePriority: Priority;
  observations: string[];
  contexts: string[];
  observationPriorities: Record<string, Priority>;
  contextPriorities: Record<string, Priority>;
};

const PRIORITY_RANK: Record<Priority, number> = { RENDAH: 0, SEDANG: 1, TINGGI: 2 };

function maxPriority(current: Priority, next: Priority): Priority {
  return PRIORITY_RANK[next] > PRIORITY_RANK[current] ? next : current;
}

export function triage(data: Record<string, unknown>, structured?: StructuredTriageOptions): TriageResult {
  const cases = integer(data.estimated_cases ?? data.reported_cases, 'Jumlah terdampak');
  const deaths = integer(data.estimated_deaths ?? data.reported_deaths, 'Jumlah meninggal');
  const severe = bool(data.has_severe_case) ? 1 : integer(data.severe_cases, 'Jumlah kasus berat');
  const hospitalized = integer(data.hospitalized_cases, 'Jumlah dirawat');

  if (structured) {
    let priority: Priority = structured.basePriority;
    const reasons: string[] = [];
    if (structured.basePriority === 'TINGGI') reasons.push('jenis kejadian berisiko tinggi');
    else if (structured.basePriority === 'SEDANG') reasons.push('jenis kejadian memerlukan verifikasi');

    if (deaths) {
      priority = 'TINGGI';
      reasons.push('terdapat kematian');
    }
    if (severe) {
      priority = 'TINGGI';
      reasons.push('terdapat kondisi berat');
    }
    if (hospitalized) {
      priority = 'TINGGI';
      reasons.push('terdapat orang yang dirawat');
    }

    const observationPriority = structured.observations.reduce<Priority>(
      (current, code) => maxPriority(current, structured.observationPriorities[code] || 'RENDAH'),
      'RENDAH'
    );
    if (observationPriority !== 'RENDAH') {
      priority = maxPriority(priority, observationPriority);
      reasons.push(observationPriority === 'TINGGI' ? 'terdapat tanda berisiko tinggi' : 'terdapat tanda yang perlu diverifikasi');
    }

    const contextPriority = structured.contexts.reduce<Priority>(
      (current, code) => maxPriority(current, structured.contextPriorities[code] || 'RENDAH'),
      'RENDAH'
    );
    if (contextPriority !== 'RENDAH') {
      priority = maxPriority(priority, contextPriority);
      reasons.push(contextPriority === 'TINGGI' ? 'terdapat pajanan berisiko tinggi' : 'terdapat konteks yang perlu diverifikasi');
    }
    if (structured.contexts.includes('SHARED_FOOD') && cases >= 2) {
      priority = 'TINGGI';
      reasons.push('beberapa orang sakit setelah konsumsi bersama');
    }
    if (cases >= 5) {
      priority = 'TINGGI';
      reasons.push('lima atau lebih orang terdampak');
    } else if (cases >= 2) {
      priority = maxPriority(priority, 'SEDANG');
      reasons.push('dua atau lebih orang terdampak');
    }

    return {
      priority,
      reason: [...new Set(reasons)].join('; ') || 'belum terdapat tanda bahaya yang dilaporkan',
      version: '4.0-master-priority',
    };
  }

  const signal = clean(data.signal_code, 50);
  const reasons: string[] = [];
  if (deaths) reasons.push('terdapat kematian');
  if (severe) reasons.push('terdapat kondisi berat');
  if (cases >= 5) reasons.push('lima atau lebih orang terdampak');
  if (['FOOD', 'RABIES', 'ENV'].includes(signal)) reasons.push('sinyal membutuhkan perhatian segera');
  if (reasons.length) return { priority: 'TINGGI', reason: reasons.join('; '), version: '2.0' };
  if (cases >= 2)
    return { priority: 'SEDANG', reason: 'dua sampai empat orang terdampak atau ada pengelompokan', version: '2.0' };
  return { priority: 'RENDAH', reason: 'kejadian tunggal tanpa tanda bahaya yang dilaporkan', version: '2.0' };
}
