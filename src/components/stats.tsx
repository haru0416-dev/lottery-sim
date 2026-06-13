// モンテカルロ統計パネル — 同条件をN回繰り返し、収支の分布と破産確率を見る。
// 計算は Web Worker プールで並列実行(主スレッドを止めず、コア数分だけ高速化)。
import { useEffect, useRef, useState } from 'react'
import { U as SU } from '../lottery-data.ts'
import { runMonteCarlo } from '../sim-runner.ts'
import type { MCHandle, MCRaw } from '../sim-runner.ts'
import type { DoDrawOpts, Game } from '../types.ts'
import { FanChart, Histogram } from './charts.tsx'

const SAMPLES = 48 // ファンチャートの時間軸サンプル点数

// 元手(バンクロール)の選択肢。0 = 設定なし(資金無限・破産判定なし)
const BANKROLLS: { label: string; value: number }[] = [
  { label: '元手なし', value: 0 },
  { label: '10万円', value: 100000 },
  { label: '50万円', value: 500000 },
  { label: '100万円', value: 1000000 },
  { label: '500万円', value: 5000000 },
]

interface TrialResult {
  finals: number[]
  count: number
  med: number
  best: number
  worst: number
  posRate: number
  avgRecovery: number
  // ファンチャート: 各サンプル点の [p5,p25,p50,p75,p95] と経過年数
  bandXs: number[]
  bands: number[][]
  // 破産統計(元手設定時のみ)
  bankroll: number
  ruinRate: number
  medianSurvivalYears: number
}

interface MultiTrialPanelProps {
  game: Game
  betType: string // Worker で effGame を再構築するため(関数 tierOf は転送できない)
  tickets: number
  totalDraws: number
  pickOpts: DoDrawOpts
  configKey: string
  disabled: boolean
}

// 昇順配列からパーセンタイル値(0..1)を取る
function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[i]
}

export function MultiTrialPanel({
  game,
  betType,
  tickets,
  totalDraws,
  pickOpts,
  configKey,
  disabled,
}: MultiTrialPanelProps) {
  const [trials, setTrials] = useState(100)
  const [bankroll, setBankroll] = useState(0)
  const [running, setRunning] = useState(false)
  const [prog, setProg] = useState(0)
  const [res, setRes] = useState<TrialResult | null>(null)
  const handleRef = useRef<MCHandle | null>(null)
  const keyRef = useRef(configKey)

  // 条件が変わったら結果を破棄&実行中ワーカーを停止(元手も結果に影響するのでキーに含める)
  const fullKey = configKey + '|br=' + bankroll
  useEffect(() => {
    if (keyRef.current !== fullKey) {
      keyRef.current = fullKey
      handleRef.current?.cancel()
      handleRef.current = null
      setRes(null)
      setRunning(false)
      setProg(0)
    }
  }, [fullKey])

  useEffect(
    () => () => {
      handleRef.current?.cancel()
    },
    [],
  )

  // MCRaw(全試行の生データ) → 表示用の統計・帯へ集計
  function aggregate(raw: MCRaw, total: number, sampleAt: number[], dpy: number, B: number): TrialResult {
    const sorted = raw.finals.slice().sort((a, b) => a - b)
    const K = sampleAt.length
    const bandXs = sampleAt.map((n) => n / dpy)
    const bands: number[][] = []
    const col: number[] = Array.from({ length: raw.trajectories.length }, () => 0)
    for (let k = 0; k < K; k++) {
      for (let tn = 0; tn < raw.trajectories.length; tn++) col[tn] = raw.trajectories[tn][k]
      col.sort((a, b) => a - b)
      bands.push([pctile(col, 0.05), pctile(col, 0.25), pctile(col, 0.5), pctile(col, 0.75), pctile(col, 0.95)])
    }
    const survSorted = raw.survival.slice().sort((a, b) => a - b)
    return {
      finals: raw.finals,
      count: total,
      med: sorted[Math.floor(sorted.length / 2)],
      best: sorted[sorted.length - 1],
      worst: sorted[0],
      posRate: raw.finals.filter((v) => v > 0).length / raw.finals.length,
      avgRecovery: raw.costSum > 0 ? (raw.winSum / raw.costSum) * 100 : 0,
      bandXs,
      bands,
      bankroll: B,
      ruinRate: B > 0 ? raw.ruinCount / total : 0,
      medianSurvivalYears: pctile(survSorted, 0.5) / dpy,
    }
  }

  function toggle() {
    if (running) {
      handleRef.current?.cancel()
      handleRef.current = null
      setRunning(false)
      return
    }
    setRunning(true)
    setRes(null)
    setProg(0)

    const td = totalDraws,
      total = trials,
      B = bankroll
    const dpy = game.drawsPerYear
    const K = Math.max(2, Math.min(SAMPLES, td))
    const sampleAt: number[] = []
    for (let k = 0; k < K; k++) sampleAt.push(Math.max(1, Math.round((td * (k + 1)) / K)))

    const handle = runMonteCarlo(
      {
        gameId: game.id,
        betType,
        tickets,
        totalDraws: td,
        opts: pickOpts,
        trials: total,
        bankroll: B,
        sampleAt,
      },
      (done) => setProg(done / total),
    )
    handleRef.current = handle
    handle.promise.then((raw) => {
      if (!raw || handleRef.current !== handle) return // キャンセル/条件変更
      setRes(aggregate(raw, total, sampleAt, dpy, B))
      setRunning(false)
      handleRef.current = null
    })
  }

  const rows = res
    ? [
        { label: '中央値', value: SU.fmtYenSignedAuto(res.med), tone: res.med >= 0 ? 'pos' : 'neg' },
        { label: '最良', value: SU.fmtYenSignedAuto(res.best), tone: res.best >= 0 ? 'pos' : 'neg' },
        { label: '最悪', value: SU.fmtYenSignedAuto(res.worst), tone: res.worst >= 0 ? 'pos' : 'neg' },
        { label: '黒字で終えた割合', value: (res.posRate * 100).toFixed(1) + '%', tone: '' },
        { label: '平均回収率', value: res.avgRecovery.toFixed(1) + '%', tone: '' },
      ]
    : []
  // 破産統計(元手設定時のみ先頭に差し込む)
  const ruinRows =
    res && res.bankroll > 0
      ? [
          { label: '破産した割合', value: (res.ruinRate * 100).toFixed(1) + '%', tone: res.ruinRate > 0 ? 'neg' : '' },
          {
            label: '資金が持つ年数(中央値)',
            value: (Math.round(res.medianSurvivalYears * 10) / 10).toLocaleString('ja-JP') + '年',
            tone: '',
          },
        ]
      : []

  return (
    <section className="panel">
      <div className="card-head">
        <h2 className="sec-title">モンテカルロ統計</h2>
        <span className="card-status num">
          {running ? Math.round(prog * 100) + '%' : res ? res.count + '回試行' : ''}
        </span>
      </div>
      <div className="mt-controls">
        <select value={trials} onChange={(e) => setTrials(+e.target.value)} aria-label="試行回数" disabled={running}>
          <option value="30">30回試行</option>
          <option value="100">100回試行</option>
          <option value="300">300回試行</option>
        </select>
        <select
          value={bankroll}
          onChange={(e) => setBankroll(+e.target.value)}
          aria-label="元手(破産判定)"
          disabled={running}
        >
          {BANKROLLS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={'btn sm' + (running ? ' danger' : ' secondary')}
          onClick={toggle}
          disabled={!running && disabled}
        >
          {running ? '■ 中止' : '▶ 試行する'}
        </button>
      </div>
      {running ? (
        <div
          className="run-progress"
          role="progressbar"
          aria-label="モンテカルロ試行の進捗"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(prog * 100)}
        >
          <i style={{ width: prog * 100 + '%' }}></i>
        </div>
      ) : null}
      {res ? (
        <div>
          <FanChart xs={res.bandXs} bands={res.bands} yearsTotal={res.bandXs[res.bandXs.length - 1] || 1}></FanChart>
          <div className="mt-stats">
            {[...ruinRows, ...rows].map((r) => (
              <div className="mt-stat" key={r.label}>
                <span className="mt-label">{r.label}</span>
                <strong className={'num ' + r.tone}>{r.value}</strong>
              </div>
            ))}
          </div>
          <details className="mt-hist">
            <summary>最終収支の分布(ヒストグラム)を見る</summary>
            <Histogram values={res.finals} median={res.med}></Histogram>
          </details>
          <p className="pick-note">
            現在の設定(期間×購入数)をまるごと{res.count}
            回繰り返した収支推移の分布です。帯は中央値・25–75%・5–95%の範囲。
            {res.bankroll > 0
              ? `元手${SU.fmtYenShort(res.bankroll)}で次回分を買えなくなったら破産として打ち切っています。`
              : '元手を設定すると、資金が尽きて破産する確率も分かります。'}
          </p>
        </div>
      ) : !running ? (
        <div className="empty-note">
          現在の設定をまるごと繰り返し実行し、収支推移のばらつき(運の幅)と破産確率を可視化します
        </div>
      ) : null}
    </section>
  )
}
