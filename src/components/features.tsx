// 付加機能 — プリセット / 結果サマリー / シェア画像
import { U as FU } from '../lottery-data.ts'
import type { Game, JumboStyle, PickMode, SimState } from '../types.ts'

export interface PresetSettings {
  g?: string
  y?: number
  tk?: number
  pm?: PickMode
  js?: JumboStyle
  bt?: string
}

export interface Preset {
  label: string
  s: PresetSettings
}

/** 比較対象のスナップショット */
export interface CmpResult {
  sim: SimState
  game: Game
  tickets: number
  draws: number
}

// ワンタップ設定プリセット
export const SIM_PRESETS: Preset[] = [
  { label: 'ロト6 10口×10年', s: { g: 'loto6', y: 10, tk: 10, pm: 'quick' } },
  { label: 'ロト7 5口×20年', s: { g: 'loto7', y: 20, tk: 5, pm: 'quick' } },
  { label: 'ジャンボ30枚×30年', s: { g: 'jumbo', y: 30, tk: 30, js: 'bara' } },
  { label: 'ナンバーズ3 3口×5年', s: { g: 'numbers3', y: 5, tk: 3, bt: 'ストレート' } },
]

// 超長期の複利は数値が溢れるのでlog10で扱い、命数法(億・兆・京…無量大数)で表示
const COSMIC_UNITS: [string, number][] = [
  ['無量大数', 68],
  ['不可思議', 64],
  ['那由他', 60],
  ['阿僧祇', 56],
  ['恒河沙', 52],
  ['極', 48],
  ['載', 44],
  ['正', 40],
  ['澗', 36],
  ['溝', 32],
  ['穣', 28],
  ['幺', 24],
  ['垓', 20],
  ['京', 16],
  ['兆', 12],
  ['億', 8],
  ['万', 4],
]
function fmtYenCosmic(lg: number): string {
  if (!isFinite(lg)) return '∞円'
  if (lg < 72) {
    for (let i = 0; i < COSMIC_UNITS.length; i++) {
      const name = COSMIC_UNITS[i][0],
        e = COSMIC_UNITS[i][1]
      if (lg >= e) {
        const m = Math.pow(10, lg - e)
        const s = m >= 100 ? Math.round(m).toLocaleString('ja-JP') : (Math.round(m * 10) / 10).toString()
        return '約' + s + name + '円'
      }
    }
    return '約' + Math.round(Math.pow(10, lg)).toLocaleString('ja-JP') + '円'
  }
  const exp = Math.floor(lg)
  const man = Math.round(Math.pow(10, lg - exp) * 10) / 10
  return '約' + man + '×10^' + exp.toLocaleString('ja-JP') + '円'
}

interface SummaryCardProps {
  S: SimState
  game: Game
  effGame: Game
  effTickets: number
  nisaRate: number
  cmp: CmpResult | null
  onShare: () => void
  onShareX: () => void
}

// 実行結果を一文で総括するカード
export function SummaryCard({ S, game, effTickets, nisaRate, cmp, onShare, onShareX }: SummaryCardProps) {
  const balance = S.win - S.cost
  const recovery = S.cost > 0 ? (S.win / S.cost) * 100 : 0
  const yrs = S.n / game.drawsPerYear
  const yrsLabel = (Math.round(yrs * 10) / 10).toLocaleString('ja-JP')
  // NISA運用益: 同額を年利 nisaRate% で積立運用した場合の元本を除く増加分
  let nisaGain = 0
  const nisaOk = nisaRate > 0 && yrs > 0 && yrs <= 100
  // 超長期(100年超)は桁が溢れるのでlog10空間で計算: gain ≈ A·(1+r)^t/r
  let cosmicLg: number | null = null
  if (nisaRate > 0 && yrs > 100) {
    const r = nisaRate / 100
    const A = S.cost / yrs
    cosmicLg = Math.log10(A / r) + yrs * Math.log10(1 + r)
  }
  if (nisaOk) {
    const r = nisaRate / 100
    const A = S.cost / yrs
    nisaGain = (A * (Math.pow(1 + r, yrs) - 1)) / r - S.cost
  }
  const cmpBal = cmp ? cmp.sim.win - cmp.sim.cost : 0
  const cmpRec = cmp && cmp.sim.cost > 0 ? (cmp.sim.win / cmp.sim.cost) * 100 : 0
  const cmpCond = cmp
    ? cmp.tickets + cmp.game.unitLabel + '×' + Math.round(cmp.draws / cmp.game.drawsPerYear) + '年'
    : ''
  return (
    <section className="panel summary-card">
      <div className="card-head">
        <h2 className="sec-title">結果サマリー</h2>
        <div className="share-actions">
          <button type="button" className="mini-btn" onClick={onShareX} aria-label="Xに投稿する">
            <svg className="x-icon" viewBox="0 0 24 24" aria-hidden="true" width="12" height="12">
              <path
                fill="currentColor"
                d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25h6.83l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
              ></path>
            </svg>
            でシェア
          </button>
          <button type="button" className="mini-btn" onClick={onShare}>
            画像で保存
          </button>
        </div>
      </div>
      <p className="summary-lead">
        {game.name}を{effTickets}
        {game.unitLabel}ずつ・約{yrsLabel}年({S.n.toLocaleString('ja-JP')}回)購入し、計
        <strong className="num">{FU.fmtYenAuto(S.cost)}</strong>を投入。 収支は
        <strong className={'num ' + (balance >= 0 ? 'pos' : 'neg')}>{FU.fmtYenSignedAuto(balance)}</strong>(回収率{' '}
        {recovery.toFixed(1)}%)。
      </p>
      <dl className="summary-rows">
        <div className="sr">
          <dt>当選</dt>
          <dd>
            <span className="num">{FU.fmtYenAuto(S.win)}</span>
            <span className="sr-meta">{S.winCount.toLocaleString('ja-JP')}本</span>
          </dd>
        </div>
        <div className="sr">
          <dt>最高当選</dt>
          <dd>
            {S.bestPrize > 0 ? (
              <>
                {S.bestLabel}・<span className="num">{FU.fmtYenAuto(S.bestPrize)}</span>
                <span className="sr-meta">第{S.bestAt.toLocaleString('ja-JP')}回</span>
              </>
            ) : (
              <span className="sr-muted">当選はありませんでした</span>
            )}
          </dd>
        </div>
        {cmp ? (
          <div className="sr">
            <dt>比較</dt>
            <dd>
              {cmp.game.name}({cmpCond}){' '}
              <strong className={'num ' + (cmpBal >= 0 ? 'pos' : 'neg')}>{FU.fmtYenSignedAuto(cmpBal)}</strong>
              <span className="sr-meta">回収率 {cmpRec.toFixed(1)}%</span>
            </dd>
          </div>
        ) : null}
        {nisaOk ? (
          <div className="sr">
            <dt>NISA</dt>
            <dd>
              年利{nisaRate}%で積立 → 運用益 約 <strong className="num pos">+{FU.fmtYenAuto(nisaGain)}</strong>
            </dd>
          </div>
        ) : cosmicLg != null ? (
          <div className="sr">
            <dt>NISA</dt>
            <dd>
              年利{nisaRate}%で{Math.round(yrs).toLocaleString('ja-JP')}年積立なら 運用益{' '}
              <strong className="num pos">{fmtYenCosmic(cosmicLg)}</strong>
              <span className="cosmic-note">参考: 観測可能な宇宙の原子の総数が約10^80個</span>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  )
}

export interface ShareArgs {
  S: SimState
  gameName: string
  unitLabel: string
  effTickets: number
  dpy: number
}

// 結果サマリーを 1200×675 の共有用カードとして canvas に描画(保存・X共有で共用)
function renderResultCanvas({ S, gameName, unitLabel, effTickets, dpy }: ShareArgs): HTMLCanvasElement {
  const appEl = document.querySelector('.app') || document.documentElement
  const css = getComputedStyle(appEl)
  const v = (name: string, fb: string): string => {
    const x = css.getPropertyValue(name).trim()
    return x || fb
  }
  const W = 1200,
    H = 675
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  const rr = (px: number, py: number, pw: number, ph: number, r: number) => {
    x.beginPath()
    if (x.roundRect) x.roundRect(px, py, pw, ph, r)
    else x.rect(px, py, pw, ph)
  }

  const balance = S.win - S.cost
  const recovery = S.cost > 0 ? (S.win / S.cost) * 100 : 0
  const yrs = (Math.round((S.n / dpy) * 10) / 10).toLocaleString('ja-JP')
  const accent = v('--accent', '#a93622')
  const fontSans = '"IBM Plex Sans JP", "Hiragino Sans", sans-serif'
  const fontMono = '"IBM Plex Mono", monospace'
  const fontDisplay = 'Oswald, "IBM Plex Mono", monospace'

  // 背景とカード(書き出し用に不透明色へ解決)。印刷意匠に合わせ角は立て・墨罫
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const inkStrong = isDark ? 'rgba(240,236,229,.5)' : 'rgba(33,29,25,.55)'
  const ink = v('--ink', isDark ? '#f0ece5' : '#211d19')
  x.fillStyle = v('--bg', isDark ? '#100e0c' : '#f7f5f3')
  x.fillRect(0, 0, W, H)
  x.fillStyle = isDark ? '#1b1815' : '#fefdfc'
  x.strokeStyle = inkStrong
  x.lineWidth = 1.5
  rr(48, 48, W - 96, H - 96, 3)
  x.fill()
  x.stroke()

  const cardL = 84,
    cardR = W - 84

  // タイトル(ブランド印: 朱の角印に白抜き「宝」 — アプリのヘッダーと同じ意匠)
  x.fillStyle = accent
  rr(cardL - 2, 78, 26, 26, 4)
  x.fill()
  x.fillStyle = '#ffffff'
  x.font = '700 16px ' + fontSans
  x.textAlign = 'center'
  x.fillText('宝', cardL + 11, 96)
  x.textAlign = 'left'
  x.fillStyle = ink
  x.font = '700 24px ' + fontSans
  x.fillText('宝くじシミュレーター', cardL + 34, 99)

  // ヘッダー下の子持ち罫(太罫+細罫) — 帳票の天
  x.strokeStyle = ink
  x.lineWidth = 2
  x.beginPath()
  x.moveTo(cardL, 120)
  x.lineTo(cardR, 120)
  x.stroke()
  x.lineWidth = 1
  x.beginPath()
  x.moveTo(cardL, 125)
  x.lineTo(cardR, 125)
  x.stroke()

  // 条件
  x.fillStyle = v('--ink-2', '#5d6070')
  x.font = '500 21px ' + fontSans
  x.fillText(
    gameName + '・毎回' + effTickets + unitLabel + ' × ' + S.n.toLocaleString('ja-JP') + '回(約' + yrs + '年相当)',
    84,
    152,
  )

  // 収支(主役) — 黒字=墨 / 赤字=朱、券面の組番数字(Oswald)
  x.fillStyle = balance >= 0 ? v('--pos', '#2e2a25') : v('--neg', '#a93622')
  x.font = '600 70px ' + fontDisplay
  x.fillText(FU.fmtYenSignedAuto(balance), 80, 240)

  // KPI行
  const kpis: [string, string][] = [
    ['総購入額', FU.fmtYenAuto(S.cost)],
    ['総当選額', FU.fmtYenAuto(S.win)],
    ['回収率', recovery.toFixed(1) + '%'],
  ]
  kpis.forEach((k, i) => {
    const kx = 84 + i * 380
    x.fillStyle = v('--ink-3', '#8d90a0')
    x.font = '500 17px ' + fontSans
    x.fillText(k[0], kx, 292)
    x.fillStyle = v('--ink', '#2b2d36')
    x.font = '600 28px ' + fontMono
    x.fillText(k[1], kx, 326)
  })

  // スパークライン
  const b = S.balances && S.balances.length ? S.balances : [balance]
  const gx = 84,
    gw = W - 168,
    gy = 370,
    gh = 200
  let mn = Math.min(0, ...b.slice(0, 2000)),
    mx = Math.max(0, ...b.slice(0, 2000))
  for (let i = 0; i < b.length; i++) {
    if (b[i] < mn) mn = b[i]
    if (b[i] > mx) mx = b[i]
  }
  if (mn === mx) mx = mn + 1
  const YY = (val: number): number => gy + ((mx - val) / (mx - mn)) * gh
  // ゼロライン
  x.strokeStyle = v('--ink-3', '#8d90a0')
  x.lineWidth = 1
  x.setLineDash([4, 4])
  x.beginPath()
  x.moveTo(gx, YY(0))
  x.lineTo(gx + gw, YY(0))
  x.stroke()
  x.setLineDash([])
  // 折れ線
  const stp = Math.max(1, Math.ceil(b.length / 600))
  x.strokeStyle = accent
  x.lineWidth = 3
  x.lineJoin = 'round'
  x.beginPath()
  for (let i = 0, k = 0; i < b.length; i += stp, k++) {
    const px = gx + (i / Math.max(1, b.length - 1)) * gw
    if (k === 0) x.moveTo(px, YY(b[i]))
    else x.lineTo(px, YY(b[i]))
  }
  x.lineTo(gx + gw, YY(b[b.length - 1]))
  x.stroke()
  x.fillStyle = balance >= 0 ? v('--pos', '#1c8a64') : v('--neg', '#b4513a')
  x.beginPath()
  x.arc(gx + gw, YY(b[b.length - 1]), 6, 0, Math.PI * 2)
  x.fill()

  // フッター
  x.fillStyle = v('--ink-3', '#8d90a0')
  x.font = '500 15px ' + fontSans
  const d = new Date()
  x.fillText(
    d.getFullYear() +
      '/' +
      (d.getMonth() + 1) +
      '/' +
      d.getDate() +
      ' ・ 公表確率に基づく統計シミュレーション(結果を保証するものではありません)',
    84,
    H - 76,
  )

  return c
}

const SHARE_FILENAME = '宝くじシミュレーション結果.png'

// 結果サマリーをPNG画像としてダウンロード
export function shareResultPNG(args: ShareArgs): void {
  const c = renderResultCanvas(args)
  const a = document.createElement('a')
  a.download = SHARE_FILENAME
  a.href = c.toDataURL('image/png')
  a.click()
}

// X 投稿用の本文(結果サマリー)。種類・口数・期間・収支・回収率を一文に
function buildShareText({ S, gameName, unitLabel, effTickets, dpy }: ShareArgs): string {
  const balance = S.win - S.cost
  const recovery = S.cost > 0 ? (S.win / S.cost) * 100 : 0
  const yrs = (Math.round((S.n / dpy) * 10) / 10).toLocaleString('ja-JP')
  return (
    `宝くじシミュレーターで${gameName}を${effTickets}${unitLabel}ずつ・約${yrs}年(${S.n.toLocaleString('ja-JP')}回)買ったら、` +
    `収支 ${FU.fmtYenSignedAuto(balance)}(回収率${recovery.toFixed(1)}%)でした。`
  )
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'))
}

// X へ投稿。
// 1) モバイル(coarse ポインタ)では Web Share API でOS共有シート経由 → Xに画像付き投稿
// 2) PC では汎用の「共有」シートを出さず、X の投稿画面(intent)へ直行
//    (テキスト + シナリオ復元URL。intentでは画像添付不可なのはX側の仕様)
export async function shareToX(args: ShareArgs): Promise<void> {
  const text = buildShareText(args)
  const url = location.href
  const hashtag = '宝くじシミュレーター'

  // PC版ブラウザも navigator.share に対応するため、ポインタで端末を判定する。
  // モバイル(主入力がタッチ=coarse)のときだけ画像付きネイティブ共有を使う。
  const isMobile = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  if (isMobile) {
    try {
      const blob = await canvasToBlob(renderResultCanvas(args))
      if (blob) {
        const file = new File([blob], SHARE_FILENAME, { type: 'image/png' })
        const navAny = navigator as Navigator & { canShare?: (d?: ShareData) => boolean }
        if (typeof navigator.share === 'function' && navAny.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], text: `${text}\n#${hashtag}\n${url}` })
            return
          } catch (e) {
            // ユーザーがキャンセルした場合は intent へ進めない
            if (e instanceof Error && e.name === 'AbortError') return
          }
        }
      }
    } catch {
      /* 画像生成や共有に失敗したら intent にフォールバック */
    }
  }

  // PC / Web Share 非対応: X の投稿画面を開く
  const intent =
    'https://x.com/intent/tweet?text=' +
    encodeURIComponent(text) +
    '&url=' +
    encodeURIComponent(url) +
    '&hashtags=' +
    encodeURIComponent(hashtag)
  window.open(intent, '_blank', 'noopener')
}
