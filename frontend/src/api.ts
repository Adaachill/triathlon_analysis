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

async function postQueryApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const pathStr = path.startsWith('/') ? path.slice(1) : path;
  const base = API_BASE.startsWith('http') ? API_BASE : window.location.origin + API_BASE;
  const url = new URL(pathStr, base.endsWith('/') ? base : base + '/');
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), { method: 'POST' });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail ?? '').catch(() => '');
    throw new Error(detail || `API Error: ${res.status} ${path}`);
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
  points?: number | null;
  note?: string | null;
}

export interface RaceUpdateBody {
  name?: string | null;
  date?: string | null;
  location?: string | null;
  points?: number | null;
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
  rank_avg: number | null;
}

export interface PredictResponse {
  source_label: string;
  source_filename: string;
  categories: Record<string, PredictAthlete[]>;
}

export type PredictionMode = 'none' | 'previous_year' | 'startlist'

export interface WorldRankingRace {
  race_id: number;
  race_name: string | null;
  date: string;
  points: number;
  is_future: boolean;
  is_counted: boolean;
}

export interface WorldRankingEntry {
  athlete_id: string;
  first_name: string;
  last_name: string;
  country: string;
  total_points: number;
  period1_points: number;
  period2_points_raw: number;
  period2_points: number;
  period1_races: WorldRankingRace[];
  period2_races: WorldRankingRace[];
}

export interface WorldRankingPredictedRace {
  race_id: number;
  race_name: string | null;
  date: string;
  points: number;
  based_on_race_id: number;
  based_on_race_name: string | null;
  participants_count: number;
  is_startlist: boolean;
}

export interface WorldRankingResponse {
  program_name: string;
  as_of_date: string;
  prediction_mode: PredictionMode;
  current_start: string;
  current_end: string;
  previous_start: string;
  previous_end: string;
  rankings: WorldRankingEntry[];
  predicted_races: WorldRankingPredictedRace[];
  baseline_rankings: WorldRankingEntry[] | null;
}

// World Triathlon Algolia search API (public search-only key)
const WT_ALGOLIA_APP_ID = 'GAVNABD4CQ';
const WT_ALGOLIA_API_KEY = 'a3a9ddd1c59b3f5474c08dec7839c8fb';
const WT_ALGOLIA_INDEX = 'tri_prod_events';

export interface AlgoliaEvent {
  id: number;
  name: string;
  start_date: string;
  finish_date: string;
  city: string | null;
  country_name: string;
  status: string;
  sport_categories: string[];
  specification_categories: string[];
  event_categories: string[];
  startlist_available: boolean;
  results_available: boolean;
}

export async function getUpcomingEvents(daysAhead = 365): Promise<AlgoliaEvent[]> {
  const nowTs = Math.floor(Date.now() / 1000);
  const endTs = nowTs + daysAhead * 86400;
  const url =
    `https://${WT_ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries` +
    `?x-algolia-api-key=${WT_ALGOLIA_API_KEY}&x-algolia-application-id=${WT_ALGOLIA_APP_ID}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        indexName: WT_ALGOLIA_INDEX,
        query: '',
        page: 0,
        hitsPerPage: 200,
        numericFilters: [
          `start_date_timestamp >= ${nowTs}`,
          `start_date_timestamp <= ${endTs}`,
        ],
        // Paratriathlon 専用大会か、Triathlon親大会で子要素に Para がある場合をカバー
        facetFilters: [
          ['specification_categories:Paratriathlon', 'specification_categories:Triathlon'],
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Algolia error: ${res.status}`);
  const data = await res.json();
  const hits: AlgoliaEvent[] = data.results?.[0]?.hits ?? [];
  return hits
    .filter((h) => {
      const s = (h.status ?? '').toUpperCase();
      if (s === 'CANCELLED' || s === 'POSTPONED') return false;
      // specification が Paratriathlon OR （specification が Triathlon かつ sport_categories に Paratriathlon を含む）
      return h.specification_categories.includes('Paratriathlon') ||
        (h.specification_categories.includes('Triathlon') && h.sport_categories.includes('Paratriathlon'));
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

export async function getPastParaEvents(yearsBack = 3): Promise<AlgoliaEvent[]> {
  const nowTs = Math.floor(Date.now() / 1000);
  const startTs = nowTs - yearsBack * 365 * 86400;
  const url =
    `https://${WT_ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries` +
    `?x-algolia-api-key=${WT_ALGOLIA_API_KEY}&x-algolia-application-id=${WT_ALGOLIA_APP_ID}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        indexName: WT_ALGOLIA_INDEX,
        query: '',
        page: 0,
        hitsPerPage: 200,
        numericFilters: [
          `start_date_timestamp >= ${startTs}`,
          `start_date_timestamp <= ${nowTs}`,
        ],
        facetFilters: [
          ['sport_categories:Triathlon'],
          ['specification_categories:Paratriathlon'],
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Algolia error: ${res.status}`);
  const data = await res.json();
  const hits: AlgoliaEvent[] = data.results?.[0]?.hits ?? [];
  // results_available はフロントエンド側でフィルタリング（facet 設定の有無に依存しないため）
  return hits
    .filter((h) => h.results_available)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
}

export interface WtParaEvent {
  id: number;
  name: string;
  start_date: string;
  city: string | null;
  country_name: string;
  event_categories: string[];
  win_points: number | null;
  imported: boolean;
}

export interface WtParaEventsResponse {
  events: WtParaEvent[];
}

export interface WtImportResult {
  message: string;
  race_id: number;
  event_id: string;
  added_results: number;
  skipped: boolean;
}

export interface EvalModelStat {
  mae_sec: number;
  rmse_sec: number;
  n: number;
}

export interface EvalResult {
  summary: Record<string, EvalModelStat>;
  by_segment: Record<string, Record<string, EvalModelStat>>;
  by_program: Record<string, Record<string, EvalModelStat>>;
  n_races_evaluated: number;
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
  getEvaluation: () => fetchApi<EvalResult>('/admin/evaluate_difficulty'),
  uploadStartlist: (file: File, eventId?: string, eventDate?: string, raceName?: string) => {
    const form = new FormData();
    form.append('file', file);
    const params = new URLSearchParams();
    if (eventId) params.set('event_id', eventId);
    if (eventDate) params.set('event_date', eventDate);
    if (raceName) params.set('race_name', raceName);
    const path = params.toString()
      ? `/predict/upload-startlist?${params.toString()}`
      : '/predict/upload-startlist';
    return uploadApi<PredictResponse>(path, form);
  },
  getWorldRanking: (
    programName: string,
    asOfDate: string,
    predictionMode: PredictionMode = 'none',
  ) =>
    fetchApi<WorldRankingResponse>('/world-ranking', {
      program_name: programName,
      as_of_date: asOfDate,
      prediction_mode: predictionMode,
    }),
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
  getImportedEventIds: () =>
    fetchApi<{ event_ids: string[] }>('/admin/wt/imported-event-ids'),
  importWtEvent: (params: {
    id: number;
    win_points: number;
    race_name: string;
    race_date: string;
    note?: string;
    force?: boolean;
  }) =>
    postQueryApi<WtImportResult>(`/admin/wt/import/${params.id}`, {
      win_points: String(params.win_points),
      race_name: params.race_name,
      race_date: params.race_date,
      note: params.note ?? '',
      force: String(params.force ?? false),
    }),
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

const ISO3_TO_ISO2: Record<string, string> = {
  JPN:'JP',AUS:'AU',USA:'US',GBR:'GB',FRA:'FR',GER:'DE',DEU:'DE',CHN:'CN',
  KOR:'KR',NZL:'NZ',ESP:'ES',ITA:'IT',BRA:'BR',CAN:'CA',NOR:'NO',SWE:'SE',
  FIN:'FI',DEN:'DK',DNK:'DK',BEL:'BE',NED:'NL',NLD:'NL',HUN:'HU',POL:'PL',
  CZE:'CZ',AUT:'AT',SUI:'CH',CHE:'CH',POR:'PT',PRT:'PT',MEX:'MX',ARG:'AR',
  RSA:'ZA',ZAF:'ZA',IRI:'IR',IRN:'IR',HKG:'HK',TPE:'TW',SGP:'SG',MAS:'MY',
  MYS:'MY',THA:'TH',INA:'ID',IDN:'ID',PHI:'PH',PHL:'PH',VIE:'VN',VNM:'VN',
  ISR:'IL',TUR:'TR',GRE:'GR',GRC:'GR',ROU:'RO',BUL:'BG',BGR:'BG',SLO:'SI',
  SVN:'SI',CRO:'HR',HRV:'HR',SRB:'RS',UKR:'UA',RUS:'RU',BLR:'BY',KAZ:'KZ',
  UZB:'UZ',COL:'CO',CHI:'CL',CHL:'CL',PER:'PE',VEN:'VE',URU:'UY',URY:'UY',
  ECU:'EC',PAR:'PY',PRY:'PY',BOL:'BO',EGY:'EG',MAR:'MA',TUN:'TN',ALG:'DZ',
  DZA:'DZ',NIG:'NG',NGR:'NG',KEN:'KE',ETH:'ET',GHA:'GH',IRL:'IE',ISL:'IS',
  LTU:'LT',LAT:'LV',LVA:'LV',EST:'EE',SVK:'SK',CYP:'CY',LUX:'LU',MLT:'MT',
};

/** 国コード（ISO alpha-3 or alpha-2）を国旗絵文字に変換 */
export function getCountryFlag(iso: string | null | undefined): string {
  if (!iso) return '';
  const code = iso.trim().toUpperCase();
  const alpha2 = ISO3_TO_ISO2[code] ?? (code.length === 2 ? code : null);
  if (!alpha2) return '';
  return [...alpha2].map(c => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1F1E6)).join('');
}
