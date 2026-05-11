/**
 * API クライアント
 * VITE_API_URL でバックエンドURLを指定（未設定時は /api 経由でプロキシ or 相対パス）
 */
const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

async function fetchApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const pathStr = path.startsWith('/') ? path.slice(1) : path;
  const base = API_BASE.startsWith('http') ? API_BASE : window.location.origin + API_BASE;
  const url = new URL(pathStr, base.endsWith('/') ? base : base + '/');
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${path}`);
  }
  return res.json();
}

async function uploadApi<T>(path: string, form: FormData): Promise<T> {
  const pathStr = path.startsWith('/') ? path.slice(1) : path;
  const base = API_BASE.startsWith('http') ? API_BASE : window.location.origin + API_BASE;
  const url = new URL(pathStr, base.endsWith('/') ? base : base + '/');
  const res = await fetch(url.toString(), { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail ?? '').catch(() => '');
    throw new Error(detail || `Upload Error: ${res.status}`);
  }
  return res.json();
}

async function patchApi<T>(path: string, body: object): Promise<T> {
  const pathStr = path.startsWith('/') ? path.slice(1) : path;
  const base = API_BASE.startsWith('http') ? API_BASE : window.location.origin + API_BASE;
  const url = new URL(pathStr, base.endsWith('/') ? base : base + '/');
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${path}`);
  }
  return res.json();
}

export interface Program {
  programs: string[];
}

export interface Race {
  id: number;
  event_id: string;
  name: string | null;
  date: string | null;
  location: string | null;
  is_reference: boolean;
  note?: string | null;
}

export interface RaceUpdateBody {
  name?: string | null;
  date?: string | null;
  location?: string | null;
  note?: string | null;
}

export interface RaceResult {
  athlete_id: string;
  first_name: string;
  last_name: string;
  country: string;
  program_name: string;
  swim_sec: number | null;
  t1_sec: number | null;
  bike_sec: number | null;
  t2_sec: number | null;
  run_sec: number | null;
  total_sec: number | null;
  standard_total_sec?: number | null;
  position: number | null;
  status: string;
  strength_rank?: number | null;
  pred_swim_sec?: number | null;
  pred_t1_sec?: number | null;
  pred_bike_sec?: number | null;
  pred_t2_sec?: number | null;
  pred_run_sec?: number | null;
  outlier_weight?: number | null;
}

export interface DifficultySegments {
  swim_sec: number;
  t1_sec: number;
  bike_sec: number;
  t2_sec: number;
  run_sec: number;
}

export interface DifficultySegmentsNullable {
  swim_sec: number | null;
  t1_sec: number | null;
  bike_sec: number | null;
  t2_sec: number | null;
  run_sec: number | null;
}

export interface DifficultySegmentsN {
  swim_sec: number;
  t1_sec: number;
  bike_sec: number;
  t2_sec: number;
  run_sec: number;
}

export interface RaceDetail {
  race: Race;
  difficulty_offset: number | null;
  difficulty_n: number;
  difficulty_segments: DifficultySegments | null;
  difficulty_segments_n: DifficultySegmentsN | null;
  difficulty_cross: number | null;
  difficulty_n_cross: number;
  difficulty_segments_cross: DifficultySegmentsNullable | null;
  difficulty_segments_n_cross: DifficultySegmentsN | null;
  difficulty_als: number | null;
  difficulty_n_als: number;
  difficulty_segments_als: DifficultySegmentsNullable | null;
  results: RaceResult[];
}

export interface RankingEntry {
  athlete_id: string;
  first_name: string;
  last_name: string;
  country: string;
  strength: number;
  strength_swim?: number | null;
  strength_t1?: number | null;
  strength_bike?: number | null;
  strength_t2?: number | null;
  strength_run?: number | null;
}

export interface RankingsResponse {
  program_name: string;
  rankings: RankingEntry[];
}

export interface RankingDiffEntry {
  athlete_id: string;
  first_name: string;
  last_name: string;
  country: string;
  rank_after: number;
  rank_before: number | null;
  rank_change: number | null;
  strength_after: number | null;
  strength_before: number | null;
  strength_change: number | null;
}

export interface RankingsDiffResponse {
  program_name: string;
  new_race_id: number;
  entries: RankingDiffEntry[];
}

export interface AthleteRace {
  race_id: number;
  race_name: string | null;
  event_id: string;
  date: string | null;
  total_sec: number | null;
  standard_total_sec: number | null;
  pred_total_sec: number | null;
  swim_sec: number | null;
  t1_sec: number | null;
  bike_sec: number | null;
  t2_sec: number | null;
  run_sec: number | null;
  standard_swim_sec: number | null;
  standard_t1_sec: number | null;
  standard_bike_sec: number | null;
  standard_t2_sec: number | null;
  standard_run_sec: number | null;
  pred_swim_sec: number | null;
  pred_t1_sec: number | null;
  pred_bike_sec: number | null;
  pred_t2_sec: number | null;
  pred_run_sec: number | null;
  position: number | null;
  difficulty_offset: number;
  strength_rank: number | null;
}

export interface AthleteDetail {
  athlete_id: string;
  first_name: string;
  last_name: string;
  country: string;
  program_name: string;
  strength: number | null;
  strength_swim?: number | null;
  strength_t1?: number | null;
  strength_bike?: number | null;
  strength_t2?: number | null;
  strength_run?: number | null;
  race_count: number;
  races: AthleteRace[];
}

export interface PredictSegTimes {
  total_sec: number | null;
  swim_sec: number | null;
  t1_sec: number | null;
  bike_sec: number | null;
  t2_sec: number | null;
  run_sec: number | null;
}

export interface PredictAthlete {
  athlete_id: string;
  first_name: string;
  last_name: string;
  country: string;
  program_name: string;
  start_number: number | null;
  has_history: boolean;
  strength: number | null;
  strength_swim: number | null;
  strength_t1: number | null;
  strength_bike: number | null;
  strength_t2: number | null;
  strength_run: number | null;
  pred_avg: PredictSegTimes;
  pred_devonport: PredictSegTimes;
  rank_avg: number | null;
  rank_devonport: number | null;
}

export interface PredictResponse {
  source_label: string;
  source_filename: string;
  categories: Record<string, PredictAthlete[]>;
  devonport_race_id: number | null;
  devonport_difficulties: Record<string, Record<string, number | null>>;
}

export const api = {
  getPrograms: () => fetchApi<Program>('/programs'),
  getRaces: () => fetchApi<Race[]>('/races'),
  getRace: (id: number, programName?: string) =>
    fetchApi<RaceDetail>(`/races/${id}`, programName ? { program_name: programName } : undefined),
  updateRace: (id: number, body: RaceUpdateBody) =>
    patchApi<{ race: Race }>(`/races/${id}`, body),
  getRankings: (programName: string, limit = 50) =>
    fetchApi<RankingsResponse>('/rankings/top', { program_name: programName, limit: String(limit) }),
  getRankingsDiff: (programName: string, newRaceId: number) =>
    fetchApi<RankingsDiffResponse>('/rankings/diff', { program_name: programName, new_race_id: String(newRaceId) }),
  getAthlete: (athleteId: string, programName: string) =>
    fetchApi<AthleteDetail>(`/athletes/${athleteId}`, { program_name: programName }),
  getPredictDevonport: () =>
    fetchApi<PredictResponse>('/predict/2026-devonport'),
  getPredictUploaded: () =>
    fetchApi<PredictResponse>('/predict/uploaded-startlist'),
  uploadStartlist: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return uploadApi<PredictResponse>('/predict/upload-startlist', form);
  },
  uploadRaceResult: (params: {
    file: File;
    race_name: string;
    race_date: string;
    points: number;
    note: string;
  }) => {
    const form = new FormData();
    form.append('file', params.file);
    form.append('race_name', params.race_name);
    form.append('race_date', params.race_date);
    form.append('points', String(params.points));
    form.append('note', params.note);
    return uploadApi<{ message: string; race_id: number; event_id: string; added_results: number }>(
      '/admin/upload_excel',
      form,
    );
  },
};

/** 秒数を mm:ss 形式に */
export function formatTime(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return '--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 差分秒数を ±mm:ss 形式に（正=遅い, 負=速い） */
export function formatDiff(sec: number | null | undefined): string {
  if (sec == null) return '--';
  const sign = sec >= 0 ? '+' : '-';
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${sign}${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}
