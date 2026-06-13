// 宝くじシミュレーター — メインアプリ
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { LOTTERY_GAMES as GAMES, U, effGameOf } from './lottery-data.ts'
import { doDraw, drawFrom, newSim } from './sim-engine.ts'
import { runBulk as runBulkRunner } from './sim-runner.ts'
import type { DoDrawOpts, DrawnNumbers, Game, JumboStyle, PickMode, SimState } from './types.ts'
import { BalanceLineChart, CompareBars, TierTable } from './components/charts.tsx'
import { SIM_PRESETS, SummaryCard, shareResultPNG, shareToX } from './components/features.tsx'
import type { CmpResult, PresetSettings } from './components/features.tsx'
import { MultiTrialPanel } from './components/stats.tsx'
import {
  TweakColor,
  TweakRadio,
  TweakSection,
  TweakSelect,
  TweakSlider,
  TweakToggle,
  TweaksPanel,
  useTweaks,
} from './tweaks/TweaksPanel.tsx'

interface Tweaks {
  accent: string
  theme: string
  chartFill: boolean
  signColor: boolean
  showDD: boolean
  highlightMin: string
  nisaRate: number
}

const TWEAK_DEFAULTS: Tweaks = {
  accent: '#a93622', // 朱
  theme: 'ライト',
  chartFill: true,
  signColor: true,
  showDD: true,
  highlightMin: '10万円以上',
  nisaRate: 5,
}

// 旧テーマ(グラスUI時代)のアクセントは朱へ移行する
const LEGACY_ACCENTS = ['#4053C9', '#0F8A6D', '#0E8266', '#7A5AE0', '#B3543B']

const HIGH_MAP: Record<string, number> = { '1万円以上': 10000, '10万円以上': 100000, '100万円以上': 1000000 }
// 速度は「年/秒」で定義する。draws/秒 固定だと種別ごとの drawsPerYear の差で
// 同じ期間でも実時間がバラバラ(ロト6 104回/年とジャンボ 5回/年で20倍)になるため、
// 時間軸を基準にして「P年の購入は P/yps 秒で再生」と種別非依存にする。
const SPEEDS = [
  { label: 'ゆっくり', yps: 0.5 }, // 10年 ≈ 20秒
  { label: '標準', yps: 2 }, //     10年 ≈ 5秒
  { label: '高速', yps: 8 }, //     10年 ≈ 1.25秒
  { label: '超高速', yps: 30 }, //  10年 ≈ 0.3秒
]
const CHASE_CAP = 3000000
const BET_TYPES = ['ストレート', 'ボックス', 'セット']

interface Settings {
  g?: string
  y?: number
  tk?: number
  pm?: string
  js?: string
  co?: number
  bt?: string
  cmp?: string
  cy?: number
  ctk?: number
  fx?: Record<string, number[]>
}

// 設定の保存/復元(URLハッシュ優先、なければlocalStorage)
const SETTINGS_KEY = 'lotterySim.settings.v1'

// 申込タイプは日本語のままだとURLが %E3...の壁になるのでコードへ畳む
const BT_CODE: Record<string, string> = { ストレート: 's', ボックス: 'b', セット: 't' }
const BT_FROM: Record<string, string> = { s: 'ストレート', b: 'ボックス', t: 'セット' }

// コンパクトかつ可読なシリアライズ(全ASCII・既定値/空は省略)。
// 例: "g=loto6&y=10&tk=10&pm=fixed&fx=loto6:5.8.12.20.29.36"
function encodeSettings(s: Settings): string {
  const parts: string[] = []
  const push = (k: string, v: string | number) => parts.push(k + '=' + v)
  if (s.g) push('g', s.g)
  if (s.y != null) push('y', s.y)
  if (s.tk != null) push('tk', s.tk)
  if (s.pm && s.pm !== 'quick') push('pm', s.pm) // 既定 quick は省略
  if (s.js && s.js !== 'bara') push('js', s.js) // 既定 bara は省略
  if (s.co === 0) push('co', 0) // 既定 carry on は省略、offのみ記録
  if (s.bt && s.bt !== 'ストレート' && BT_CODE[s.bt]) push('bt', BT_CODE[s.bt])
  if (s.cmp) {
    push('cmp', s.cmp)
    if (s.cy != null) push('cy', s.cy)
    if (s.ctk != null) push('ctk', s.ctk)
  }
  if (s.fx) {
    const games = Object.keys(s.fx).filter((g) => s.fx![g]?.length)
    if (games.length) push('fx', games.map((g) => g + ':' + s.fx![g].join('.')).join(';'))
  }
  return parts.join('&')
}

function decodeSettings(raw: string): Settings | null {
  if (!raw) return null
  let str = raw
  try {
    str = decodeURIComponent(raw)
  } catch {
    /* 生のまま使う */
  }
  str = str.trim()
  if (!str) return null
  // 旧JSON形式(後方互換): 過去に共有/保存されたURL・localStorageを読めるように
  if (str[0] === '{') {
    try {
      return JSON.parse(str)
    } catch {
      return null
    }
  }
  const out: Settings = {}
  for (const pair of str.split('&')) {
    const i = pair.indexOf('=')
    if (i < 0) continue
    const k = pair.slice(0, i)
    const v = pair.slice(i + 1)
    if (k === 'g') out.g = v
    else if (k === 'y') out.y = +v
    else if (k === 'tk') out.tk = +v
    else if (k === 'pm') out.pm = v
    else if (k === 'js') out.js = v
    else if (k === 'co') out.co = +v
    else if (k === 'bt') out.bt = BT_FROM[v] || v
    else if (k === 'cmp') out.cmp = v
    else if (k === 'cy') out.cy = +v
    else if (k === 'ctk') out.ctk = +v
    else if (k === 'fx') {
      const fx: Record<string, number[]> = {}
      for (const g of v.split(';')) {
        const j = g.indexOf(':')
        if (j < 0) continue
        const nums = g
          .slice(j + 1)
          .split('.')
          .map(Number)
          .filter((x) => Number.isFinite(x))
        if (nums.length) fx[g.slice(0, j)] = nums
      }
      out.fx = fx
    }
  }
  return out
}

function loadSettings(): Settings | null {
  try {
    const m = location.hash.match(/^#s=(.+)/)
    if (m) {
      const s = decodeSettings(m[1])
      if (s) return s
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return decodeSettings(raw)
  } catch {
    /* ignore */
  }
  return null
}
// 復元した固定数字を各ゲームの仕様へ正規化する(共有URL・古い設定・改変ハッシュ対策)。
// ロト系以外のキーは捨て、1..pool の整数のみ・重複排除・pick個まで。
function sanitizeFixed(fx: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  if (!fx || typeof fx !== 'object') return out
  for (const g of GAMES) {
    if (!g.lotto) continue
    const arr = (fx as Record<string, unknown>)[g.id]
    if (!Array.isArray(arr)) continue
    const seen = new Set<number>()
    const clean: number[] = []
    for (const v of arr) {
      const n = Math.round(Number(v))
      if (Number.isInteger(n) && n >= 1 && n <= g.lotto.pool && !seen.has(n)) {
        seen.add(n)
        clean.push(n)
        if (clean.length >= g.lotto.pick) break
      }
    }
    if (clean.length) out[g.id] = clean.sort((a, b) => a - b)
  }
  return out
}

const INIT: Settings = loadSettings() || {}
const INIT_FX = sanitizeFixed(INIT.fx)
const clampNum = (v: unknown, lo: number, hi: number, fb: number): number =>
  typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fb

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function DrawnNums({ nums }: { nums: DrawnNumbers }) {
  // この回に抽出された当せん番号(本数字 + B: ボーナス数字)。購入した数字ではない
  return (
    <span className="lg-nums num" title="この回に抽出された当せん番号(本数字とボーナス数字)">
      <em className="lg-nums-label">当せん番号</em>
      {nums.main.map(pad2).join(' ')}
      <i>B</i>
      {nums.bonus.map(pad2).join(' ')}
    </span>
  )
}

function NumberGrid({
  pool,
  pick,
  selected,
  onChange,
}: {
  pool: number
  pick: number
  selected: number[]
  onChange: (arr: number[]) => void
}) {
  const toggle = (n: number) => {
    if (selected.includes(n)) onChange(selected.filter((v) => v !== n))
    else if (selected.length < pick) onChange([...selected, n].sort((a, b) => a - b))
  }
  const cells: number[] = []
  for (let n = 1; n <= pool; n++) cells.push(n)
  const full = selected.length >= pick
  return (
    <div className={'num-grid' + (full ? ' full' : '')}>
      {cells.map((n) => {
        const on = selected.includes(n)
        return (
          <button
            key={n}
            type="button"
            className={'num-cell num' + (on ? ' on' : '')}
            aria-pressed={on}
            aria-disabled={full && !on ? true : undefined}
            onClick={() => toggle(n)}
          >
            {pad2(n)}
          </button>
        )
      })}
    </div>
  )
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="kpi panel">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value num' + (tone ? ' ' + tone : '')}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

// ── 重量パネル(memo) ───────────────────────────────────────────────────────
// アニメ中の再レンダーが最も高くつく3パネルを分離。S はランごとに同一参照で
// 中身だけが書き換わるため、props の version が変わった時だけ再レンダーされる。
// 実行中は version を約150msごとに進め、チャート/KPI(毎フレーム)から切り離す。

const TierPanel = memo(function TierPanel({
  S,
  effGame,
  effTickets,
  version,
}: {
  S: SimState | null
  effGame: Game
  effTickets: number
  version: number
}) {
  void version
  return (
    <section className="panel">
      <h2 className="sec-title">当選等級の内訳</h2>
      <TierTable
        game={effGame}
        tierCounts={S ? S.tierCounts : null}
        tierAmounts={S ? S.tierAmounts : null}
        totalTickets={S ? S.n * effTickets : 0}
      ></TierTable>
    </section>
  )
})

const HighlightsPanel = memo(function HighlightsPanel({
  S,
  highlightMin,
  highMin,
  version,
}: {
  S: SimState | null
  highlightMin: string
  highMin: number
  version: number
}) {
  void version
  const highs = S ? S.highs.filter((h) => h.prize >= highMin) : []
  return (
    <section className="panel grow">
      <div className="card-head">
        <h2 className="sec-title">高額当選ハイライト</h2>
        <span className="card-status">{highlightMin}</span>
      </div>
      {highs.length === 0 ? (
        <div className="empty-note">
          {S ? 'まだ' + highlightMin + 'の当選はありません' : '実行するとここに表示されます'}
        </div>
      ) : (
        <ul className="high-list">
          {highs
            .slice(-12)
            .reverse()
            .map((h, idx) => (
              <li key={h.i + '-' + idx}>
                <span className="hl-draw num">第{h.i.toLocaleString('ja-JP')}回</span>
                <span className="hl-tier">
                  {h.label}
                  {h.count > 1 ? ' ×' + h.count.toLocaleString('ja-JP') : ''}
                </span>
                <span className="hl-prize num">{U.fmtYenAuto(h.prize * (h.count || 1))}</span>
              </li>
            ))}
        </ul>
      )}
      {highs.length > 12 ? <div className="more-note">ほか {(highs.length - 12).toLocaleString('ja-JP')}件</div> : null}
    </section>
  )
})

const LogPanel = memo(function LogPanel({
  S,
  unitLabel,
  highMin,
  version,
}: {
  S: SimState | null
  unitLabel: string
  highMin: number
  version: number
}) {
  void version
  const logRows = S ? S.log.slice(-60).reverse() : []
  return (
    <section className="panel">
      <div className="card-head">
        <h2 className="sec-title">購入ログ</h2>
        <span className="card-status">直近{Math.min(logRows.length, 60)}件</span>
      </div>
      {logRows.length === 0 ? (
        <div className="empty-note">実行すると購入履歴がここに流れます</div>
      ) : (
        <div className="log-list" role="list">
          {logRows.map((r) => (
            <div
              className={'log-row' + (r.win > 0 ? ' win' : '') + (r.win >= highMin ? ' big' : '')}
              key={r.i}
              role="listitem"
            >
              <div className="log-main">
                <span className="lg-draw num">第{r.i.toLocaleString('ja-JP')}回</span>
                <span className="lg-buy num">
                  {r.tickets}
                  {unitLabel} −{U.fmtYen(r.cost).slice(1)}
                </span>
                <span className="lg-result num">
                  {r.win > 0 ? '+' + U.fmtYenAuto(r.win).replace('¥', '') : 'はずれ'}
                </span>
                <span className="lg-tier">{r.best || ''}</span>
              </div>
              {r.nums ? <DrawnNums nums={r.nums}></DrawnNums> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
})

export function App() {
  const [t, setTweak] = useTweaks<Tweaks>(TWEAK_DEFAULTS)
  const [gameId, setGameId] = useState(GAMES.some((g) => g.id === INIT.g) ? (INIT.g as string) : 'loto6')
  const [pickMode, setPickMode] = useState<PickMode>(INIT.pm === 'fixed' ? 'fixed' : 'quick')
  const [fixedNums, setFixedNums] = useState<Record<string, number[]>>(INIT_FX)
  const [jumboStyle, setJumboStyle] = useState<JumboStyle>(INIT.js === 'renban' ? 'renban' : 'bara')
  const [carryOn, setCarryOn] = useState(INIT.co != null ? !!INIT.co : true)
  const [betType, setBetType] = useState(BET_TYPES.includes(INIT.bt as string) ? (INIT.bt as string) : 'ストレート')
  const [cmpId, setCmpId] = useState(GAMES.some((g) => g.id === INIT.cmp) ? (INIT.cmp as string) : '')
  const [cmpYears, setCmpYears] = useState(clampNum(INIT.cy, 1, 50, clampNum(INIT.y, 1, 50, 10)))
  const [cmpTickets, setCmpTickets] = useState(clampNum(INIT.ctk, 1, 100, clampNum(INIT.tk, 1, 100, 10)))
  const [chasing, setChasing] = useState(false)
  const [years, setYears] = useState(clampNum(INIT.y, 1, 50, 10))
  const [tickets, setTickets] = useState(clampNum(INIT.tk, 1, 100, 10))
  const [speedIdx, setSpeedIdx] = useState(2)
  const [running, setRunning] = useState(false)
  const [computing, setComputing] = useState(false) // 一括をワーカー実行中
  const [toast, setToast] = useState<{ label: string; amt: number; key: number } | null>(null)
  const [tick, setTick] = useState(0)
  // 重量パネル(ログ/等級表/ハイライト)用のスロー更新カウンタ(実行中 約150ms間隔)
  const [slowTick, setSlowTick] = useState(0)
  const lastSlowRef = useRef(0)

  const simRef = useRef<SimState | null>(null)
  const cmpSimRef = useRef<CmpResult | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef(0)
  const accRef = useRef(0)
  const lastBumpRef = useRef(0)
  const runningRef = useRef(false)
  const chasingRef = useRef(false)
  const seenHighRef = useRef(0)
  const carryShowRef = useRef({ t: 0, v: 0 })
  const frameCostRef = useRef(16)

  const game = useMemo(() => GAMES.find((g) => g.id === gameId) as Game, [gameId])
  // ナンバーズは申込タイプで賞金体系が変わる(Worker と同じ effGameOf を共用)
  const effGame = useMemo<Game>(() => effGameOf(gameId, betType), [gameId, betType])

  const effTickets = game.pack10 ? Math.max(10, Math.round(tickets / 10) * 10) : tickets
  const totalDraws = years * game.drawsPerYear
  const fixedSel = fixedNums[gameId] || []
  const pickOpts: DoDrawOpts = { mode: pickMode, fixed: fixedSel, jumboStyle: jumboStyle, carryOn: carryOn }
  const fixedReady = !game.lotto || pickMode !== 'fixed' || fixedSel.length === game.lotto.pick
  const ev = U.evOf(effGame)
  const rr = U.returnRateOf(effGame)
  const cmpGame = useMemo(
    () => (cmpId && cmpId !== gameId ? GAMES.find((g) => g.id === cmpId) || null : null),
    [cmpId, gameId],
  )
  const S = simRef.current

  // アニメーション中も最新値を参照できるようrefに同期(クロージャから読むため)
  const speedIdxRef = useRef(speedIdx)
  speedIdxRef.current = speedIdx
  const gameRef = useRef(effGame)
  gameRef.current = effGame
  const ticketsRef = useRef(effTickets)
  ticketsRef.current = effTickets
  const totalDrawsRef = useRef(totalDraws)
  totalDrawsRef.current = totalDraws
  const pickOptsRef = useRef(pickOpts)
  pickOptsRef.current = pickOpts

  // 一括(ワーカー非同期)の結果が古くなっていないか判定するための設定キー。
  // game/betType/口数/年数/固定数字/比較条件いずれの変更も検知できるよう最新値をrefに保持。
  const bulkKey = [
    gameId,
    betType,
    pickMode,
    fixedSel.join('.'),
    jumboStyle,
    carryOn ? 1 : 0,
    years,
    effTickets,
    cmpId,
    cmpYears,
    cmpTickets,
  ].join('|')
  const bulkKeyRef = useRef(bulkKey)
  bulkKeyRef.current = bulkKey

  const bump = () => setTick((x) => x + 1)
  // アダプティブ再描画: 描画が追いついている間は毎フレーム(ヌルヌル)、
  // フレーム落ちを検知したら自動的に間引く(シミュレーション計算は常にフル速度)
  // 軽量部(チャート/KPI)は毎フレーム、重量パネルは slowTick(約150ms)で更新。
  const bumpAdaptive = (frameDt: number) => {
    // 直近フレーム間隔の指数移動平均
    if (frameDt > 0) frameCostRef.current = frameCostRef.current * 0.8 + frameDt * 0.2
    const now = performance.now()
    const struggling = frameCostRef.current > 26 // 38fpsを割ったら間引き開始
    if (!struggling || now - lastBumpRef.current >= 80) {
      lastBumpRef.current = now
      setTick((x) => x + 1)
    }
    if (now - lastSlowRef.current >= 150) {
      lastSlowRef.current = now
      setSlowTick((x) => x + 1)
    }
  }

  const stopAnim = useCallback(() => {
    runningRef.current = false
    setRunning(false)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const stopChase = useCallback(() => {
    chasingRef.current = false
    setChasing(false)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const stopAll = useCallback(() => {
    stopAnim()
    stopChase()
  }, [stopAnim, stopChase])

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  // テーマ切替
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.theme === 'ダーク' ? 'dark' : 'light')
  }, [t.theme])

  // 設定をlocalStorage + URLハッシュへ保存
  // スライダードラッグ中の連続書込を避けるため300msデバウンス
  // (Safari は replaceState を 100回/30秒 でレート制限するため必須)
  useEffect(() => {
    const id = setTimeout(() => {
      // 固定数字は「数字を固定モードで、現在の種類に選択がある」ときだけ保存する。
      // (fixedNums は種類別の選択キャッシュだが、クイックピック時は使われないので
      //  URL/保存には載せない)
      const fxSel = pickMode === 'fixed' ? fixedNums[gameId] : undefined
      const s: Settings = {
        g: gameId,
        y: years,
        tk: tickets,
        pm: pickMode,
        js: jumboStyle,
        co: carryOn ? 1 : 0,
        bt: betType,
        cmp: cmpId,
        cy: cmpYears,
        ctk: cmpTickets,
        fx: fxSel && fxSel.length ? { [gameId]: fxSel } : undefined,
      }
      const enc = encodeSettings(s) // コンパクト・全ASCII(percent-encode不要)
      try {
        localStorage.setItem(SETTINGS_KEY, enc)
      } catch {
        /* ignore */
      }
      try {
        history.replaceState(null, '', '#s=' + enc)
      } catch {
        /* ignore */
      }
    }, 300)
    return () => clearTimeout(id)
  }, [gameId, years, tickets, pickMode, jumboStyle, carryOn, betType, cmpId, cmpYears, cmpTickets, fixedNums])

  // 旧テーマ(グラスUI時代)のアクセントが保存されていたら朱へ移行
  useEffect(() => {
    if (LEGACY_ACCENTS.some((c) => c.toLowerCase() === t.accent.toLowerCase())) setTweak('accent', '#a93622')
  }, [t.accent, setTweak])

  // 比較条件が変わったら古い比較結果を破棄(実行中は維持)
  useEffect(() => {
    if (!runningRef.current && !chasingRef.current) {
      cmpSimRef.current = null
      bump()
    }
  }, [cmpId, cmpYears, cmpTickets])

  // 当選演出(高額当選トースト) — アニメーション実行中のみ。
  // tick/slowTick は毎フレームの bump で進むので、それを依存にして「描画更新のたびに
  // 新しい高額当選を検知」する(seenHighRef で重複表示を防ぐため無限ループにはならない)。
  useEffect(() => {
    if (!S || (!running && !chasing)) return
    const hs = S.highs
    if (!hs || !hs.length) return
    const lastH = hs[hs.length - 1]
    const tot = lastH.prize * (lastH.count || 1)
    if (tot >= 1000000 && lastH.i > seenHighRef.current) {
      seenHighRef.current = lastH.i
      setToast({ label: lastH.label, amt: tot, key: lastH.i })
    }
  }, [S, running, chasing, tick, slowTick])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(id)
  }, [toast])

  function selectGame(id: string) {
    if (id === gameId) return
    stopAll()
    simRef.current = null
    cmpSimRef.current = null
    seenHighRef.current = 0
    setGameId(id)
  }

  function reset() {
    stopAll()
    simRef.current = null
    cmpSimRef.current = null
    seenHighRef.current = 0
    setToast(null)
    bump()
  }

  function applyPreset(s: PresetSettings) {
    stopAll()
    simRef.current = null
    cmpSimRef.current = null
    seenHighRef.current = 0
    if (s.g && GAMES.some((g) => g.id === s.g)) setGameId(s.g)
    if (s.y) setYears(s.y)
    if (s.tk) setTickets(s.tk)
    if (s.pm) setPickMode(s.pm)
    if (s.js) setJumboStyle(s.js)
    if (s.bt) setBetType(s.bt)
    bump()
  }

  // モバイルでは実行後に結果部へスクロール(reduced-motion 設定を尊重)
  function scrollToResults() {
    if (window.innerWidth >= 960) return
    const m = document.querySelector('.main') as HTMLElement | null
    if (!m) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: m.offsetTop - 8, behavior: reduce ? 'auto' : 'smooth' })
  }

  // 一括シミュレーション(比較対象があれば並走)。
  // 計算は Web Worker に逃がし主スレッドをブロックしない(大きい構成のフリーズ防止)。
  async function runBulk() {
    if (!fixedReady || computing) return
    stopAll()
    seenHighRef.current = 0
    setComputing(true)
    const myKey = bulkKey // 実行開始時の設定を退避(await後に変化していたら破棄)
    const eff2 = cmpGame ? (cmpGame.pack10 ? Math.max(10, Math.round(cmpTickets / 10) * 10) : cmpTickets) : 0
    const d2 = cmpGame ? cmpYears * cmpGame.drawsPerYear : 0
    try {
      const { sim, cmp } = await runBulkRunner({
        gameId,
        betType,
        tickets: effTickets,
        totalDraws,
        opts: pickOpts,
        cmp: cmpGame
          ? {
              gameId: cmpGame.id,
              betType: 'ストレート',
              tickets: eff2,
              totalDraws: d2,
              opts: { mode: 'quick', jumboStyle: 'bara', carryOn },
            }
          : null,
      })
      // await 中に設定(種類/年数/口数/比較 等)が変わっていたら古い結果なので破棄
      if (bulkKeyRef.current !== myKey) return
      simRef.current = sim
      cmpSimRef.current = cmp && cmpGame ? { sim: cmp, game: cmpGame, tickets: eff2, draws: d2 } : null
      bump()
      scrollToResults()
    } finally {
      setComputing(false)
    }
  }

  // 連続購入アニメーション(比較対象があれば同じ時間軸で同期並走)
  function toggleAnim() {
    if (runningRef.current) {
      stopAnim()
      return
    }
    if (!fixedReady) return
    stopChase()
    if (!simRef.current || simRef.current.n >= totalDraws) {
      simRef.current = newSim()
      seenHighRef.current = 0
      if (cmpSimRef.current) cmpSimRef.current = Object.assign({}, cmpSimRef.current, { sim: newSim() })
    }
    if (cmpGame) {
      const eff2 = cmpGame.pack10 ? Math.max(10, Math.round(cmpTickets / 10) * 10) : cmpTickets
      if (!cmpSimRef.current || cmpSimRef.current.game.id !== cmpGame.id) {
        cmpSimRef.current = { sim: newSim(), game: cmpGame, tickets: eff2, draws: cmpYears * cmpGame.drawsPerYear }
      }
    } else {
      cmpSimRef.current = null
    }
    runningRef.current = true
    setRunning(true)
    lastRef.current = performance.now()
    accRef.current = 0
    const step = (now: number) => {
      if (!runningRef.current) return
      const dt = Math.min(0.25, (now - lastRef.current) / 1000)
      lastRef.current = now
      // 年/秒 × 年間抽せん回数 = この種別での draws/秒。種別によらず時間進行を一定にする
      accRef.current += dt * SPEEDS[speedIdxRef.current].yps * gameRef.current.drawsPerYear
      let k = Math.floor(accRef.current)
      accRef.current -= k
      const sim = simRef.current!
      while (k-- > 0 && sim.n < totalDrawsRef.current)
        doDraw(gameRef.current, ticketsRef.current, sim, pickOptsRef.current)
      // 比較対象を同じ経過年数まで追いつかせる(抽せん頻度の違いを時間軸で同期)
      const C2 = cmpSimRef.current
      if (C2) {
        const target = Math.min(C2.draws, Math.round((sim.n / gameRef.current.drawsPerYear) * C2.game.drawsPerYear))
        const o2: DoDrawOpts = { mode: 'quick', jumboStyle: 'bara', carryOn: pickOptsRef.current.carryOn }
        while (C2.sim.n < target) doDraw(C2.game, C2.tickets, C2.sim, o2)
      }
      if (sim.n >= totalDrawsRef.current) {
        stopAnim()
        bump()
        return
      }
      bumpAdaptive(dt * 1000)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    scrollToResults()
  }

  // 1等が出るまで回す(チェイスモード)
  function toggleChase() {
    if (chasingRef.current) {
      stopChase()
      bump()
      return
    }
    if (!fixedReady) return
    stopAnim()
    cmpSimRef.current = null
    simRef.current = newSim()
    seenHighRef.current = 0
    chasingRef.current = true
    setChasing(true)
    lastRef.current = 0
    frameCostRef.current = 16
    const loop = () => {
      if (!chasingRef.current) return
      const sim = simRef.current!
      const t0 = performance.now()
      const chaseDt = lastRef.current > 0 ? t0 - lastRef.current : 0
      lastRef.current = t0
      // 計算予算はフレーム16.6msのうち9ms。残りをReactの描画とブラウザのレイアウト/
      // ペイントに残す(旧14msでは描画ヘッドルームが2.6msしかなく毎フレーム落ちていた)
      while (performance.now() - t0 < 9) {
        for (let b = 0; b < 200; b++) {
          doDraw(gameRef.current, ticketsRef.current, sim, pickOptsRef.current)
          if (sim.firstJackpotAt) break
        }
        if (sim.firstJackpotAt || sim.n >= CHASE_CAP) break
      }
      if (sim.firstJackpotAt || sim.n >= CHASE_CAP) {
        stopChase()
        bump()
        return
      }
      bumpAdaptive(chaseDt)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    scrollToResults()
  }

  const balance = S ? S.win - S.cost : 0
  const recovery = S && S.cost > 0 ? (S.win / S.cost) * 100 : 0
  const yearsElapsed = S ? S.n / game.drawsPerYear : 0
  const highMin = HIGH_MAP[t.highlightMin] || 100000
  const highs = S ? S.highs.filter((h) => h.prize >= highMin) : []
  const markerList =
    S && S.firstJackpotAt && !S.highs.some((h) => h.i === S.firstJackpotAt && h.label === effGame.tiers[0].label)
      ? highs.concat([{ i: S.firstJackpotAt, label: effGame.tiers[0].label, prize: S.jackpotPrize, count: 1 }])
      : highs
  const chaseCapped = S && !chasing && !S.firstJackpotAt && S.n >= CHASE_CAP
  // 重量パネルの更新バージョン: 実行中はスロー(150ms)、停止中は通常tickに追従
  const heavyVersion = running || chasing ? slowTick : tick
  // キャリーオーバー表示はアニメ中のチラつき防止のため400msごとに更新
  let carryDisp = S ? S.carry : 0
  if (S && (running || chasing)) {
    const nowT = performance.now()
    if (nowT - carryShowRef.current.t >= 400) carryShowRef.current = { t: nowT, v: S.carry }
    carryDisp = carryShowRef.current.v
  } else {
    carryShowRef.current = { t: 0, v: carryDisp }
  }
  const C = cmpSimRef.current
  const showSummary = S && S.n > 0 && !running && !chasing
  const configKey = [
    gameId,
    betType,
    pickMode,
    fixedSel.join('.'),
    jumboStyle,
    carryOn ? 1 : 0,
    years,
    effTickets,
  ].join('|')

  return (
    <div
      className={'app' + (running || chasing ? ' is-running' : '')}
      style={{ '--accent': t.accent } as CSSProperties}
    >
      {toast ? (
        <div className="win-toast" key={toast.key} role="status">
          <span className="wt-badge">当選</span>
          <span className="wt-label">{toast.label}</span>
          <strong className="num">{U.fmtYenAuto(toast.amt)}</strong>
        </div>
      ) : null}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            宝
          </span>
          <h1>宝くじシミュレーター</h1>
        </div>
        <div className="topbar-note">公表確率・理論賞金額に基づく統計シミュレーション</div>
      </header>

      <div className="layout">
        <aside className="side">
          <section className="panel">
            <h2 className="sec-title">宝くじの種類</h2>
            <div className="game-chips">
              {GAMES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={'chip' + (g.id === gameId ? ' active' : '')}
                  aria-pressed={g.id === gameId}
                  onClick={() => selectGame(g.id)}
                >
                  <span className="chip-name">{g.name}</span>
                  <span className="chip-price num">¥{g.price}</span>
                </button>
              ))}
            </div>
            <div className="game-info">
              <div className="gi-row">
                <span>類型</span>
                <strong>{effGame.sub}</strong>
              </div>
              <div className="gi-row">
                <span>抽せん・発売</span>
                <strong>{game.freq}</strong>
              </div>
              <div className="gi-row">
                <span>{effGame.tiers[0].label === '1等' ? '1等賞金' : '最高賞金'}</span>
                <strong className="num">{U.fmtYenShort(effGame.tiers[0].prize)}</strong>
              </div>
              <div className="gi-row">
                <span>{effGame.tiers[0].label === '1等' ? '1等確率' : '当選確率'}</span>
                <strong className="num">{U.fmtProb(effGame.tiers[0])}</strong>
              </div>
              <div className="gi-row" title="1口(枚)あたりに戻ってくる賞金の理論平均額">
                <span>
                  期待値 / 1{game.unitLabel}
                  <span className="sr-only">(1口あたりに戻ってくる賞金の理論平均額)</span>
                </span>
                <strong className="num">{'¥' + (Math.round(ev * 10) / 10).toLocaleString('ja-JP')}</strong>
              </div>
              <div className="gi-row" title="投入額のうち賞金として戻る理論割合">
                <span>
                  理論還元率
                  <span className="sr-only">(投入額のうち賞金として戻る理論割合)</span>
                </span>
                <strong className="num">{(rr * 100).toFixed(1)}%</strong>
              </div>
            </div>
          </section>

          {game.lotto ? (
            <section className="panel">
              <h2 className="sec-title">数字の選び方(物理抽せん)</h2>
              <div className="seg">
                <button
                  type="button"
                  className={'seg-btn' + (pickMode === 'quick' ? ' on' : '')}
                  aria-pressed={pickMode === 'quick'}
                  onClick={() => setPickMode('quick')}
                >
                  クイックピック
                </button>
                <button
                  type="button"
                  className={'seg-btn' + (pickMode === 'fixed' ? ' on' : '')}
                  aria-pressed={pickMode === 'fixed'}
                  onClick={() => setPickMode('fixed')}
                >
                  数字を固定
                </button>
              </div>
              {pickMode === 'quick' ? (
                <p className="pick-note">毎回ランダムな数字で購入し、抽出された本数字・ボーナス数字と照合します。</p>
              ) : (
                <div>
                  <div className="pick-head">
                    <span className={'pick-count num' + (fixedReady ? ' ok' : '')}>
                      {fixedSel.length} / {game.lotto.pick}個選択
                    </span>
                    <span className="pick-actions">
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={() =>
                          setFixedNums({
                            ...fixedNums,
                            [gameId]: drawFrom(game.lotto!.pool, game.lotto!.pick).sort((a, b) => a - b),
                          })
                        }
                      >
                        おまかせ
                      </button>
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={() => setFixedNums({ ...fixedNums, [gameId]: [] })}
                      >
                        クリア
                      </button>
                    </span>
                  </div>
                  <NumberGrid
                    pool={game.lotto.pool}
                    pick={game.lotto.pick}
                    selected={fixedSel}
                    onChange={(arr) => setFixedNums({ ...fixedNums, [gameId]: arr })}
                  ></NumberGrid>
                  {!fixedReady ? (
                    <p className="pick-note warn">あと{game.lotto.pick - fixedSel.length}個選んでください</p>
                  ) : (
                    <p className="pick-note">
                      毎回同じ数字で購入します(口数分重複購入)。※賞金は当せん口数での山分けのため、同一数字の複数口は1等の総額が増えず、2等など当せん本数の少ない等級も1口あたり減額されます。
                    </p>
                  )}
                </div>
              )}
            </section>
          ) : null}

          {game.numbers ? (
            <section className="panel">
              <h2 className="sec-title">申込タイプ</h2>
              <div className="seg cols3">
                {BET_TYPES.map((bt) => (
                  <button
                    key={bt}
                    type="button"
                    className={'seg-btn' + (betType === bt ? ' on' : '')}
                    aria-pressed={betType === bt}
                    onClick={() => {
                      setBetType(bt)
                      simRef.current = null
                      cmpSimRef.current = null
                      bump()
                    }}
                  >
                    {bt}
                  </button>
                ))}
              </div>
              <p className="pick-note">
                {betType === 'ストレート'
                  ? '数字と並び順がすべて一致で当選。'
                  : betType === 'ボックス'
                    ? '並び順は問わず、数字の組合せが一致で当選(全桁異なる数字を選んだ場合の理論値)。'
                    : 'ストレートとボックスに半分ずつ申込み。並び順まで一致なら高額、組合せのみ一致でも当選(全桁異なる数字の理論値)。'}
              </p>
            </section>
          ) : null}

          {game.pack10 ? (
            <section className="panel">
              <h2 className="sec-title">買い方(10枚1セット)</h2>
              <div className="seg">
                <button
                  type="button"
                  className={'seg-btn' + (jumboStyle === 'bara' ? ' on' : '')}
                  aria-pressed={jumboStyle === 'bara'}
                  onClick={() => setJumboStyle('bara')}
                >
                  バラ
                </button>
                <button
                  type="button"
                  className={'seg-btn' + (jumboStyle === 'renban' ? ' on' : '')}
                  aria-pressed={jumboStyle === 'renban'}
                  onClick={() => setJumboStyle('renban')}
                >
                  連番
                </button>
              </div>
              <p className="pick-note">
                {jumboStyle === 'bara'
                  ? '組・番号がバラバラの10枚。前後賞は1等と無関係に単独でも当たります。'
                  : '同じ組の連続番号10枚。1等が当たると前後賞×2も同時に当選します。'}
                どちらも10枚ごとに7等(下1けた)が1本確定。
              </p>
            </section>
          ) : null}

          {game.carry ? (
            <section className="panel">
              <h2 className="sec-title">キャリーオーバー</h2>
              <label className="check-row">
                <input type="checkbox" checked={carryOn} onChange={(e) => setCarryOn(e.target.checked)}></input>
                <span>繰越の仕組みを再現する</span>
              </label>
              <p className="pick-note">
                全国で1等が出ない回は賞金原資が翌回へ繰越。1等は最高{U.fmtYenShort(game.carry.cap)}まで増額されます。
              </p>
              {carryOn && S ? (
                <div className="carry-status">
                  <span>現在の繰越額</span>
                  <strong className="num">{U.fmtYenShort(carryDisp)}</strong>
                  <span>次回の1等賞金</span>
                  <strong className="num">
                    {U.fmtYenShort(Math.min(game.carry.cap, game.tiers[0].prize + carryDisp))}
                  </strong>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="panel">
            <h2 className="sec-title">自動購入の設定</h2>
            <div className="preset-chips">
              {SIM_PRESETS.map((p) => (
                <button key={p.label} type="button" className="pchip" onClick={() => applyPreset(p.s)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="ctrl">
              <div className="ctrl-line">
                <label htmlFor="ctl-years">購入期間</label>
                <span className="num">{years}年</span>
              </div>
              <input
                id="ctl-years"
                type="range"
                min="1"
                max="50"
                step="1"
                value={years}
                aria-valuetext={years + '年'}
                onChange={(e) => setYears(+e.target.value)}
              ></input>
            </div>
            <div className="ctrl">
              <div className="ctrl-line">
                <label htmlFor="ctl-tickets">毎回の購入数</label>
                <span className="num">
                  {game.pack10 ? effTickets + '枚(' + effTickets / 10 + 'セット)' : tickets + game.unitLabel}
                </span>
              </div>
              <input
                id="ctl-tickets"
                type="range"
                min={game.pack10 ? 10 : 1}
                max="100"
                step={game.pack10 ? 10 : 1}
                value={game.pack10 ? effTickets : tickets}
                aria-valuetext={game.pack10 ? effTickets + '枚' : tickets + game.unitLabel}
                onChange={(e) => setTickets(+e.target.value)}
              ></input>
            </div>
            <div className="ctrl">
              <div className="ctrl-line">
                <label>比較対象(一括・連続購入で並走)</label>
              </div>
              <select
                className="cmp-select"
                value={cmpId}
                onChange={(e) => {
                  const id = e.target.value
                  setCmpId(id)
                  if (id) {
                    setCmpYears(years)
                    setCmpTickets(tickets)
                  }
                }}
                aria-label="比較対象"
              >
                <option value="">なし</option>
                {GAMES.filter((g) => g.id !== gameId).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            {cmpGame ? (
              <div className="cmp-sub">
                <div className="ctrl">
                  <div className="ctrl-line">
                    <label htmlFor="ctl-cmp-years">比較の期間</label>
                    <span className="num">{cmpYears}年</span>
                  </div>
                  <input
                    id="ctl-cmp-years"
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={cmpYears}
                    aria-valuetext={cmpYears + '年'}
                    onChange={(e) => setCmpYears(+e.target.value)}
                  ></input>
                </div>
                <div className="ctrl">
                  <div className="ctrl-line">
                    <label htmlFor="ctl-cmp-tickets">比較の購入数</label>
                    <span className="num">
                      {cmpGame.pack10
                        ? Math.max(10, Math.round(cmpTickets / 10) * 10) + '枚'
                        : cmpTickets + cmpGame.unitLabel}
                    </span>
                  </div>
                  <input
                    id="ctl-cmp-tickets"
                    type="range"
                    min={cmpGame.pack10 ? 10 : 1}
                    max="100"
                    step={cmpGame.pack10 ? 10 : 1}
                    value={cmpGame.pack10 ? Math.max(10, Math.round(cmpTickets / 10) * 10) : cmpTickets}
                    aria-valuetext={
                      cmpGame.pack10
                        ? Math.max(10, Math.round(cmpTickets / 10) * 10) + '枚'
                        : cmpTickets + cmpGame.unitLabel
                    }
                    onChange={(e) => setCmpTickets(+e.target.value)}
                  ></input>
                </div>
              </div>
            ) : null}
            <div className="plan-note">
              {game.freq.includes('仮定') ? '週1回' : '毎回'}購入 × {years}年 ={' '}
              <strong className="num">{totalDraws.toLocaleString('ja-JP')}回</strong>
              <br></br>
              総購入額 <strong className="num">{U.fmtYenAuto(totalDraws * effTickets * game.price)}</strong>
            </div>

            <button
              type="button"
              className="btn primary"
              onClick={runBulk}
              disabled={!fixedReady || computing}
              aria-busy={computing}
            >
              {computing ? '計算中…' : '一括シミュレーション実行'}
            </button>
            <div className="anim-row">
              <button
                type="button"
                className={'btn' + (running ? ' danger' : ' secondary')}
                onClick={toggleAnim}
                disabled={(!running && !fixedReady) || computing}
              >
                {running ? '■ 停止' : '▶ 連続購入を眺める'}
              </button>
              <select value={speedIdx} onChange={(e) => setSpeedIdx(+e.target.value)} aria-label="再生速度">
                {SPEEDS.map((s, i) => (
                  <option key={s.label} value={i}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={'btn' + (chasing ? ' danger' : ' secondary')}
              onClick={toggleChase}
              disabled={(!chasing && !fixedReady) || computing}
            >
              {chasing
                ? '■ 停止 — 第' + (S ? S.n.toLocaleString('ja-JP') : '0') + '回'
                : effGame.tiers[0].label + 'が出るまで回す'}
            </button>
            {chasing ? (
              <p className="pick-note">
                期間設定に関係なく{effGame.tiers[0].label}が出るまで購入し続けます(最大300万回)
              </p>
            ) : null}
            <button type="button" className="btn ghost" onClick={reset}>
              リセット
            </button>
          </section>

          <p className="disclaimer">
            <strong>非公式</strong>
            の娯楽・教育目的シミュレーターです（公式の宝くじ・発売元とは無関係）。実在のお金は動きません。
          </p>
          <details className="about">
            <summary>データの前提と注意</summary>
            <ul>
              <li>
                公式の宝くじ・発売元(みずほ銀行等)とは<strong>無関係</strong>の非公式アプリです。
              </li>
              <li>確率・賞金は公表されている理論値/代表値に基づきます。実際は回号・販売状況で変動します。</li>
              <li>ジャンボは年末ジャンボ型、スクラッチは1等100万円型・週1回購入と仮定しています。</li>
              <li>ナンバーズのボックス/セットは、全桁が異なる数字を選んだ場合の理論値です。</li>
              <li>
                ロト系は本数字+ボーナス数字を実際に抽出して照合(物理抽せん)。当せん金は山分け(パリミュチュエル)を近似しています。
              </li>
              <li>キャリーオーバーの発生確率は販売規模からの推定値です。</li>
              <li>購入を推奨するものではありません。のめり込みにはご注意ください。</li>
            </ul>
          </details>
        </aside>

        <main className="main">
          {S && S.firstJackpotAt ? (
            <div className="jackpot-banner">
              <span className="jb-badge">
                {effGame.tiers[0].label === '1等' ? '1等当選' : effGame.tiers[0].label + ' 当選'}
              </span>
              <span className="jb-text">
                第<strong className="num">{S.firstJackpotAt.toLocaleString('ja-JP')}</strong>回(約
                {(S.firstJackpotAt / game.drawsPerYear).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}年相当)
              </span>
              <span className="jb-text">
                賞金 <strong className="num">{U.fmtYenAuto(S.jackpotPrize)}</strong>
              </span>
              <span className="jb-text">
                時点投入額 <strong className="num">{U.fmtYenAuto(S.costAtJackpot)}</strong>
              </span>
            </div>
          ) : null}
          {chaseCapped ? (
            <div className="cap-note">
              {CHASE_CAP.toLocaleString('ja-JP')}回まで回しましたが{effGame.tiers[0].label}は出ませんでした(打ち切り)
            </div>
          ) : null}
          <div className="kpis">
            <KpiCard
              label="総購入額"
              value={S ? U.fmtYenAuto(S.cost) : '¥0'}
              sub={S ? S.n.toLocaleString('ja-JP') + '回 × ' + effTickets + game.unitLabel : '未実行'}
            ></KpiCard>
            <KpiCard
              label="総当選額"
              value={S ? U.fmtYenAuto(S.win) : '¥0'}
              sub={S ? '当せん ' + S.winCount.toLocaleString('ja-JP') + '本' : '未実行'}
            ></KpiCard>
            <KpiCard
              label="収支"
              value={S ? U.fmtYenSignedAuto(balance) : '±¥0'}
              tone={balance > 0 ? 'pos' : balance < 0 ? 'neg' : ''}
              sub={S ? '経過 ' + (Math.round(yearsElapsed * 10) / 10).toLocaleString('ja-JP') + '年相当' : '未実行'}
            ></KpiCard>
            <KpiCard
              label="回収率"
              value={(S ? recovery.toFixed(1) : '0.0') + '%'}
              tone={S && recovery >= 100 ? 'pos' : ''}
              sub={'理論還元率 ' + (rr * 100).toFixed(1) + '%'}
            ></KpiCard>
          </div>

          {showSummary ? (
            <SummaryCard
              S={S}
              game={game}
              effGame={effGame}
              effTickets={effTickets}
              nisaRate={t.nisaRate}
              cmp={C}
              onShare={() =>
                shareResultPNG({
                  S: S,
                  gameName: game.name,
                  unitLabel: game.unitLabel,
                  effTickets: effTickets,
                  dpy: game.drawsPerYear,
                })
              }
              onShareX={() =>
                shareToX({
                  S: S,
                  gameName: game.name,
                  unitLabel: game.unitLabel,
                  effTickets: effTickets,
                  dpy: game.drawsPerYear,
                })
              }
            ></SummaryCard>
          ) : null}

          <section className="panel chart-card">
            <div className="card-head">
              <h2 className="sec-title">累積収支の推移</h2>
              <span className="card-status num">
                {S
                  ? S.n > totalDraws
                    ? S.n.toLocaleString('ja-JP') + '回'
                    : S.n.toLocaleString('ja-JP') + ' / ' + totalDraws.toLocaleString('ja-JP') + '回'
                  : ''}
              </span>
            </div>
            {running && S ? (
              <div
                className="run-progress"
                role="progressbar"
                aria-label="連続購入の進捗"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round((S.n / totalDraws) * 100))}
              >
                <i style={{ width: Math.min(100, (S.n / totalDraws) * 100) + '%' }}></i>
              </div>
            ) : null}
            <BalanceLineChart
              balances={S ? S.balances : null}
              total={chasing || (S && S.n > totalDraws) ? (S ? S.n : totalDraws) : totalDraws}
              stride={S ? S.balStride : 1}
              accent={t.accent}
              fill={t.chartFill}
              signColor={t.signColor}
              expPerDraw={effTickets * (ev - game.price)}
              markers={markerList}
              endN={S ? S.n : 0}
              endV={S ? balance : null}
              dpy={game.drawsPerYear}
              yearsTotal={C ? Math.max(years, C.draws / C.game.drawsPerYear) : null}
              mainName={game.name}
              overlay={
                C && S
                  ? {
                      balances: C.sim.balances,
                      stride: C.sim.balStride,
                      endN: C.sim.n,
                      endV: C.sim.win - C.sim.cost,
                      dpy: C.game.drawsPerYear,
                      name: C.game.name,
                    }
                  : null
              }
              savings={{ rate: t.nisaRate, costPerDraw: game.price * effTickets }}
              live={running || chasing}
              showDD={t.showDD}
            ></BalanceLineChart>
          </section>

          {/* 結果専用パネルは実行後だけ表示(初回の空プレースホルダの壁を避ける) */}
          {S ? (
            <div className="grid2">
              <TierPanel S={S} effGame={effGame} effTickets={effTickets} version={heavyVersion}></TierPanel>

              <div className="stack">
                <section className="panel">
                  <h2 className="sec-title">投資額 vs 回収額</h2>
                  <CompareBars invest={S.cost} ret={S.win} accent={t.accent}></CompareBars>
                </section>
                <HighlightsPanel
                  S={S}
                  highlightMin={t.highlightMin}
                  highMin={highMin}
                  version={heavyVersion}
                ></HighlightsPanel>
              </div>
            </div>
          ) : null}

          <MultiTrialPanel
            game={effGame}
            betType={betType}
            tickets={effTickets}
            totalDraws={totalDraws}
            pickOpts={pickOpts}
            configKey={configKey}
            disabled={!fixedReady}
          ></MultiTrialPanel>

          {S ? <LogPanel S={S} unitLabel={game.unitLabel} highMin={highMin} version={heavyVersion}></LogPanel> : null}
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="テーマ"></TweakSection>
        <TweakRadio
          label="モード"
          value={t.theme}
          options={['ライト', 'ダーク']}
          onChange={(v) => setTweak('theme', v)}
        ></TweakRadio>
        <TweakColor
          label="アクセント(伝統インク)"
          value={t.accent}
          options={['#a93622', '#395595', '#2e663c', '#794368']}
          onChange={(v) => setTweak('accent', v as string)}
        ></TweakColor>
        <TweakSection label="グラフ"></TweakSection>
        <TweakToggle label="塗りつぶし" value={t.chartFill} onChange={(v) => setTweak('chartFill', v)}></TweakToggle>
        <TweakToggle
          label="プラス/マイナスで色分け"
          value={t.signColor}
          onChange={(v) => setTweak('signColor', v)}
        ></TweakToggle>
        <TweakToggle
          label="最大下落(ドローダウン)"
          value={t.showDD}
          onChange={(v) => setTweak('showDD', v)}
        ></TweakToggle>
        <TweakSlider
          label="NISA想定利回り%(参照線)"
          value={t.nisaRate}
          min={0}
          max={10}
          step={0.5}
          onChange={(v) => setTweak('nisaRate', v)}
        ></TweakSlider>
        <TweakSection label="表示"></TweakSection>
        <TweakSelect
          label="ハイライト基準"
          value={t.highlightMin}
          options={['1万円以上', '10万円以上', '100万円以上']}
          onChange={(v) => setTweak('highlightMin', v)}
        ></TweakSelect>
      </TweaksPanel>
    </div>
  )
}
