// SVGチャートコンポーネント群
import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { U as CU } from '../lottery-data.ts'
import type { Game, HighEntry } from '../types.ts'

export function useMeasure() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(220, e.contentRect.width))
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

// キリの良い目盛り値を計算
function niceTicks(lo: number, hi: number, target: number): number[] {
  const raw = (hi - lo) / target
  if (!(raw > 0)) return [0]
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  let step = 10 * mag
  for (const m of [1, 2, 2.5, 5, 10]) {
    // 8%の許容: 僅差(例 512k vs 500k)で次の段へ飛んで目盛りが2本になるのを防ぐ
    if (m * mag >= raw * 0.92) {
      step = m * mag
      break
    }
  }
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(v)
  return ticks
}

interface OverlaySeries {
  balances: number[]
  stride: number
  endN: number
  endV: number
  dpy: number
  name: string
}

interface BalanceLineChartProps {
  balances: number[] | null
  total: number
  stride: number
  accent: string
  fill: boolean
  signColor: boolean
  expPerDraw: number
  markers: HighEntry[]
  endN: number
  endV: number | null
  dpy: number
  yearsTotal: number | null
  overlay: OverlaySeries | null
  mainName: string
  savings: { rate: number; costPerDraw: number }
  /** アニメ/チェイス実行中(ライブ描画中は描き込みアニメを抑止) */
  live: boolean
  /** 最大ドローダウン区間の表示 */
  showDD: boolean
}

// 累積収支の折れ線チャート
// overlay があるときはX軸が「経過年数」になり、2系列を重ねる
export function BalanceLineChart({
  balances,
  total,
  stride,
  accent,
  fill,
  signColor,
  expPerDraw,
  markers,
  endN,
  endV,
  dpy,
  yearsTotal,
  overlay,
  mainName,
  savings,
  live,
  showDD,
}: BalanceLineChartProps) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  // SVG defs の id はドキュメント全体で一意にする(チャート複数描画時の衝突防止)
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const clipId = 'plotclip-' + uid
  const signLineId = 'signline-' + uid
  const signFillId = 'signfill-' + uid
  const balFillId = 'balfill-' + uid
  const hatchId = 'ddhatch-' + uid
  const h = 280

  if (!balances || balances.length === 0) {
    return (
      <div className="chart-empty" ref={ref}>
        <span className="ce-title">まだ実行していません</span>
        <span className="ce-hint">
          種類と期間・口数を選び「一括シミュレーション実行」を押すと、累積収支の推移がここに表示されます
        </span>
      </div>
    )
  }

  const n = balances.length
  const st = stride || 1
  const lastStored = n * st
  const draws = endN && endN > lastStored ? endN : lastStored
  const padL = 74,
    padR = 20,
    padT = 14,
    padB = 30
  const plotW = Math.max(1, w - padL - padR)

  // 比較系列
  let ov: {
    b: number[]
    n: number
    st: number
    dpy: number
    endN: number
    endV: number
    name: string
    lastStored: number
    draws: number
  } | null = null
  if (overlay && overlay.balances && overlay.balances.length) {
    const lastStored2 = overlay.balances.length * (overlay.stride || 1)
    ov = {
      b: overlay.balances,
      n: overlay.balances.length,
      st: overlay.stride || 1,
      dpy: overlay.dpy || 1,
      endN: overlay.endN,
      endV: overlay.endV,
      name: overlay.name || '比較',
      lastStored: lastStored2,
      draws: overlay.endN && overlay.endN > lastStored2 ? overlay.endN : lastStored2,
    }
  }
  const yearsMode = !!(ov && yearsTotal && dpy)

  // 全データからmin/maxを計算(現在値・比較系列も含める)
  let minY = 0,
    maxY = 0
  for (let i = 0; i < n; i++) {
    if (balances[i] < minY) minY = balances[i]
    if (balances[i] > maxY) maxY = balances[i]
  }
  if (endV != null) {
    if (endV < minY) minY = endV
    if (endV > maxY) maxY = endV
  }
  if (ov) {
    for (let i = 0; i < ov.n; i++) {
      if (ov.b[i] < minY) minY = ov.b[i]
      if (ov.b[i] > maxY) maxY = ov.b[i]
    }
    if (ov.endV != null) {
      if (ov.endV < minY) minY = ov.endV
      if (ov.endV > maxY) maxY = ov.endV
    }
  }

  const denom = yearsMode ? (yearsTotal as number) : Math.max(total || draws, draws)
  const endDraws = yearsMode ? (yearsTotal as number) * dpy : denom
  // メイン系列自身の終端(比較側が長期の場合、参照線はメインの範囲で止める)
  const endDrawsMain = yearsMode ? Math.min(Math.max(total || draws, draws), endDraws) : denom

  // NISA参照線(運用益): 毎回 costPerDraw 円を年利 rate% で積立運用した場合の「元本を除く増えた分」
  // 100年を超える超長期(チェイスモード等)は複利が非現実的な桁になるため省略
  const sav = savings && savings.rate > 0 && dpy && endDrawsMain / dpy <= 100 ? savings : null
  const nisaGainAt = (dI: number): number => {
    if (!sav) return 0
    const r = sav.rate / 100
    const tY = dI / dpy
    const A = sav.costPerDraw * dpy // 年間積立額
    if (r <= 0 || tY <= 0) return 0
    const fv = (A * (Math.pow(1 + r, tY) - 1)) / r // 年末積立の複利評価額
    return fv - A * tY
  }
  if (sav) {
    const savEnd = nisaGainAt(endDrawsMain)
    if (savEnd > maxY) maxY = savEnd
  }

  if (minY === 0 && maxY === 0) maxY = 1000
  const range = maxY - minY
  minY -= range * 0.06
  maxY += range * 0.06

  const XD = (i: number, sdpy: number): number =>
    yearsMode ? padL + (i / sdpy / (yearsTotal as number)) * plotW : padL + (i / denom) * plotW
  const X = (i: number): number => XD(i, dpy || 1)
  const Y = (v: number): number => padT + ((maxY - v) / (maxY - minY)) * (h - padT - padB)

  // ダウンサンプリングして折れ線点列を作る
  const buildPts = (
    b: number[],
    st_: number,
    lastStored_: number,
    draws_: number,
    endV_: number | null,
  ): [number, number][] => {
    const N = b.length
    const stp = Math.max(1, Math.ceil(N / 400))
    const arr: [number, number][] = []
    for (let i = 0; i < N; i += stp) arr.push([(i + 1) * st_, b[i]])
    if (arr[arr.length - 1][0] !== lastStored_) arr.push([lastStored_, b[N - 1]])
    // 間引き境界とずれていても、現在の収支を必ず終端に反映
    if (endV_ != null && draws_ > lastStored_) arr.push([draws_, endV_])
    return arr
  }

  const pts = buildPts(balances, st, lastStored, draws, endV)
  const linePath = pts.map((p, i) => (i === 0 ? 'M' : 'L') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')
  const areaPath =
    linePath +
    ' L' +
    X(pts[pts.length - 1][0]).toFixed(1) +
    ',' +
    Y(0).toFixed(1) +
    ' L' +
    X(pts[0][0]).toFixed(1) +
    ',' +
    Y(0).toFixed(1) +
    ' Z'

  let ovPath: string | null = null
  if (ov) {
    const pts2 = buildPts(ov.b, ov.st, ov.lastStored, ov.draws, ov.endV)
    ovPath = pts2
      .map((p, i) => (i === 0 ? 'M' : 'L') + XD(p[0], ov!.dpy).toFixed(1) + ',' + Y(p[1]).toFixed(1))
      .join(' ')
  }

  let savPath: string | null = null
  if (sav) {
    const segs: string[] = []
    for (let k = 0; k <= 40; k++) {
      const dI = (endDrawsMain * k) / 40
      segs.push((k === 0 ? 'M' : 'L') + X(dI).toFixed(1) + ',' + Y(nisaGainAt(dI)).toFixed(1))
    }
    savPath = segs.join(' ')
  }

  // 丸い値の目盛り
  const yTicks = niceTicks(minY, maxY, 5)
  const xTicks = yearsMode
    ? niceTicks(0, yearsTotal as number, 5).filter((v) => v >= 0)
    : niceTicks(0, denom, 5).filter((v) => v >= 0)

  const last = endV != null ? endV : balances[n - 1]
  const lastColor = last >= 0 ? 'var(--pos)' : 'var(--neg)'
  const labelOnTop = Y(last) > padT + 26

  // ゼロライン上下で色分けするためのグラデーション境界(px空間)
  const zeroT = Math.max(0, Math.min(1, (Y(0) - padT) / (h - padT - padB)))
  const strokeRef = signColor ? `url(#${signLineId})` : accent

  // 理論収支の参照線(期待値ベース: 1回あたり expPerDraw 円)
  const showTheory = typeof expPerDraw === 'number' && isFinite(expPerDraw)

  // 高額当選マーカー
  const mks = (markers || []).filter((m) => m.i <= draws).slice(0, 120)

  // 最高点・最低点・最大ドローダウン(メイン系列、間引き境界外の現在値も含めて走査)
  let peakV = -Infinity,
    peakI = 0,
    lowV = Infinity,
    lowI = 0
  let ddPeakV = -Infinity,
    ddPeakI = 0,
    dd = 0,
    ddFromI = 0,
    ddToI = 0
  {
    const scan = (di: number, v: number) => {
      if (v > peakV) {
        peakV = v
        peakI = di
      }
      if (v < lowV) {
        lowV = v
        lowI = di
      }
      if (v > ddPeakV) {
        ddPeakV = v
        ddPeakI = di
      }
      const fall = ddPeakV - v
      if (fall > dd) {
        dd = fall
        ddFromI = ddPeakI
        ddToI = di
      }
    }
    for (let i = 0; i < n; i++) scan((i + 1) * st, balances[i])
    if (endV != null && draws > lastStored) scan(draws, endV)
  }
  // 表示条件: 「利益のピークから落ちた」物語があるときだけ。
  // 単調下落では最大下落=全期間となり全面ハッチ化して情報量ゼロのため、
  // ピークが黒字(>0)かつ区間がプロット幅の70%以下のときに限る。
  const ddSpanFrac = (X(ddToI) - X(ddFromI)) / plotW
  const showDDSpan =
    showDD && dd > 0 && ddPeakV > 0 && ddToI > ddFromI && dd >= (maxY - minY) * 0.06 && ddSpanFrac <= 0.7

  // 最高点・最低点の付箋ラベル(終端ラベルや互いと重なるときは省略)
  const endX = X(draws)
  const annots: { x: number; y: number; t: string; above: boolean }[] = []
  if (peakV > 0 && Math.abs(X(peakI) - endX) > 56) {
    annots.push({ x: X(peakI), y: Y(peakV), t: CU.fmtYenSignedAuto(peakV), above: true })
  }
  if (lowV < 0 && Math.abs(X(lowI) - endX) > 56 && lowI !== peakI) {
    annots.push({ x: X(lowI), y: Y(lowV), t: CU.fmtYenSignedAuto(lowV), above: false })
  }

  // ホバー処理
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    let i: number
    if (yearsMode) i = Math.round(((x - padL) / plotW) * (yearsTotal as number) * dpy)
    else i = Math.round(((x - padL) / plotW) * denom)
    i = Math.max(1, Math.min(draws, i))
    setHover(i)
  }
  let hv: { i: number; v: number } | null = null
  if (hover && hover <= draws) {
    if (endV != null && hover > lastStored) {
      hv = { i: draws, v: endV }
    } else {
      const idx = Math.max(1, Math.min(n, Math.round(hover / st)))
      hv = { i: idx * st, v: balances[idx - 1] }
    }
  }
  let tip: {
    hx: number
    hy: number
    bx: number
    by: number
    boxW: number
    boxH: number
    lines: { t: string; cls: string; c: string | null }[]
    dotColor: string
  } | null = null
  if (hv) {
    const lines: { t: string; cls: string; c: string | null }[] = [
      {
        t: '第' + hv.i.toLocaleString('ja-JP') + '回' + (dpy ? '(' + (hv.i / dpy).toFixed(1) + '年)' : ''),
        cls: 'tip-label',
        c: null,
      },
      { t: CU.fmtYenSignedAuto(hv.v), cls: 'tip-value', c: hv.v >= 0 ? 'var(--pos)' : 'var(--neg)' },
    ]
    // 期待値線(理論収支)との乖離 — 運でどれだけ上振れ/下振れしたか
    if (showTheory) {
      lines.push({ t: '理論比 ' + CU.fmtYenSignedAuto(hv.v - expPerDraw * hv.i), cls: 'tip-label', c: null })
    }
    if (ov) {
      const oi = Math.max(1, Math.min(ov.draws, Math.round((hv.i / dpy) * ov.dpy)))
      let ovv: number
      if (ov.endV != null && oi > ov.lastStored) ovv = ov.endV
      else {
        const k = Math.max(1, Math.min(ov.n, Math.round(oi / ov.st)))
        ovv = ov.b[k - 1]
      }
      lines.push({ t: ov.name + ' ' + CU.fmtYenSignedAuto(ovv), cls: 'tip-label', c: 'var(--cmpline)' })
    }
    const boxW = Math.max(...lines.map((l) => l.t.length)) * 11 + 22
    const boxH = 12 + lines.length * 16
    const hx = X(hv.i)
    const flip = hx + 12 + boxW > w - padR
    const bx = flip ? hx - 12 - boxW : hx + 12
    const by = Math.max(padT, Math.min(Y(hv.v) - 22, h - padB - boxH - 4))
    tip = {
      hx,
      hy: Y(hv.v),
      bx,
      by,
      boxW,
      boxH,
      lines,
      dotColor: signColor ? (hv.v >= 0 ? 'var(--pos)' : 'var(--neg)') : accent,
    }
  }

  return (
    <div ref={ref} className="chart-wrap">
      <div className="chart-legend">
        <span className="lg-item">
          <i className="lg-line" style={{ background: signColor ? 'var(--pos)' : accent }}></i>
          {ov ? mainName || '実績収支' : '実績収支'}
        </span>
        {ov ? (
          <span className="lg-item">
            <i className="lg-line" style={{ background: 'var(--cmpline)' }}></i>
            {ov.name}
          </span>
        ) : null}
        {showTheory ? (
          <span className="lg-item">
            <i className="lg-dash"></i>理論収支(期待値)
          </span>
        ) : null}
        {sav ? (
          <span className="lg-item">
            <i className="lg-dash sav"></i>NISAで運用していたら(運用益)
          </span>
        ) : null}
        {mks.length > 0 ? (
          <span className="lg-item">
            <i className="lg-dot" style={{ background: accent }}></i>高額当選
          </span>
        ) : null}
        {showDDSpan ? (
          <span className="lg-item">
            <i className="lg-hatch"></i>最大下落 {CU.fmtYenShort(-dd)}
          </span>
        ) : null}
      </div>
      <svg
        width={w}
        height={h}
        role="img"
        aria-label={'累積収支の推移。現在 第' + draws.toLocaleString('ja-JP') + '回、収支 ' + CU.fmtYenSignedAuto(last)}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: 'pan-y' }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={padL} y={padT} width={plotW} height={h - padT - padB}></rect>
          </clipPath>
          <linearGradient id={signLineId} gradientUnits="userSpaceOnUse" x1="0" y1={padT} x2="0" y2={h - padB}>
            <stop offset="0" style={{ stopColor: 'var(--pos)' }}></stop>
            <stop offset={zeroT} style={{ stopColor: 'var(--pos)' }}></stop>
            <stop offset={zeroT} style={{ stopColor: 'var(--neg)' }}></stop>
            <stop offset="1" style={{ stopColor: 'var(--neg)' }}></stop>
          </linearGradient>
          <linearGradient id={signFillId} gradientUnits="userSpaceOnUse" x1="0" y1={padT} x2="0" y2={h - padB}>
            <stop offset="0" style={{ stopColor: 'var(--pos)', stopOpacity: 0.14 }}></stop>
            <stop offset={zeroT} style={{ stopColor: 'var(--pos)', stopOpacity: 0.03 }}></stop>
            <stop offset={zeroT} style={{ stopColor: 'var(--neg)', stopOpacity: 0.03 }}></stop>
            <stop offset="1" style={{ stopColor: 'var(--neg)', stopOpacity: 0.14 }}></stop>
          </linearGradient>
          <linearGradient id={balFillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.16"></stop>
            <stop offset="100%" stopColor={accent} stopOpacity="0.02"></stop>
          </linearGradient>
          {/* 最大ドローダウン区間: 帳簿の訂正斜線風ハッチ */}
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--neg)" strokeWidth="1.2" opacity="0.22"></line>
          </pattern>
        </defs>
        {yTicks.map((v, i) => (
          <g key={'y' + i}>
            <line x1={padL} x2={w - padR} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" strokeWidth="1"></line>
            <text x={padL - 8} y={Y(v) + 4} textAnchor="end" className="tick-label">
              {CU.fmtYenShort(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text
            key={'x' + i}
            x={Math.min(yearsMode ? padL + (v / (yearsTotal as number)) * plotW : X(v), w - padR)}
            y={h - 8}
            textAnchor={i === 0 ? 'start' : 'middle'}
            className="tick-label"
          >
            {v.toLocaleString('ja-JP') + (i === xTicks.length - 1 ? (yearsMode ? '年' : '回') : yearsMode ? '年' : '')}
          </text>
        ))}
        <line x1={padL} x2={w - padR} y1={Y(0)} y2={Y(0)} stroke="var(--ink-3)" strokeWidth="1"></line>
        {showDDSpan ? (
          <rect
            x={X(ddFromI)}
            y={padT}
            width={Math.max(2, X(ddToI) - X(ddFromI))}
            height={h - padT - padB}
            fill={`url(#${hatchId})`}
            clipPath={`url(#${clipId})`}
            style={{ pointerEvents: 'none' }}
          ></rect>
        ) : null}
        {/* 一括結果の確定時(非ライブ)だけ、墨線をペンで引く描き込みアニメ(reduced-motion 対応) */}
        <g key={live ? 'live' : 'r' + draws} className={live ? undefined : 'chart-anim-in'}>
          {fill ? (
            <path
              className="balance-area"
              d={areaPath}
              fill={signColor ? `url(#${signFillId})` : `url(#${balFillId})`}
              clipPath={`url(#${clipId})`}
            ></path>
          ) : null}
          {showTheory ? (
            <line
              x1={X(0)}
              y1={Y(0)}
              x2={X(endDrawsMain)}
              y2={Y(endDrawsMain * expPerDraw)}
              stroke="var(--ink-3)"
              strokeWidth="1.2"
              strokeDasharray="5 5"
              clipPath={`url(#${clipId})`}
            ></line>
          ) : null}
          {savPath ? (
            // NISA参照線は藍(帳簿の青ペン注記)。黒字=墨と被らない色で
            <path
              d={savPath}
              fill="none"
              stroke="var(--annot)"
              strokeWidth="1.4"
              strokeDasharray="2 4"
              clipPath={`url(#${clipId})`}
            ></path>
          ) : null}
          {ovPath ? (
            <path
              d={ovPath}
              fill="none"
              stroke="var(--cmpline)"
              strokeWidth="1.8"
              strokeLinejoin="round"
              clipPath={`url(#${clipId})`}
            ></path>
          ) : null}
          <path
            className="balance-line"
            pathLength={1}
            d={linePath}
            fill="none"
            stroke={strokeRef}
            strokeWidth="2"
            strokeLinejoin="round"
            clipPath={`url(#${clipId})`}
          ></path>
        </g>
        {annots.map((a, i) => (
          <g key={'an' + i} style={{ pointerEvents: 'none' }}>
            <line
              x1={a.x}
              x2={a.x}
              y1={a.y}
              y2={a.above ? a.y - 6 : a.y + 6}
              stroke="var(--ink-3)"
              strokeWidth="1"
            ></line>
            <text
              x={Math.max(padL + 24, Math.min(w - padR - 24, a.x))}
              y={a.above ? Math.max(padT + 9, a.y - 10) : Math.min(h - padB - 4, a.y + 17)}
              textAnchor="middle"
              className="annot-label"
            >
              {a.t}
            </text>
          </g>
        ))}
        {mks.map((m, idx) => (
          <circle
            key={'m' + idx}
            cx={X(m.i)}
            cy={Y(balances[Math.max(0, Math.min(n - 1, Math.round(m.i / st) - 1))])}
            r="3.2"
            fill={accent}
            stroke="var(--card)"
            strokeWidth="1.2"
            style={{ pointerEvents: 'none' }}
          ></circle>
        ))}
        {ov && ov.endV != null ? (
          <circle cx={XD(ov.draws, ov.dpy)} cy={Y(ov.endV)} r="3.5" fill="var(--cmpline)"></circle>
        ) : null}
        <circle cx={X(draws)} cy={Y(last)} r="4" fill={lastColor}></circle>
        {!hv ? (
          <text
            x={Math.min(X(draws), w - padR - 4)}
            y={labelOnTop ? Y(last) - 10 : Y(last) + 20}
            textAnchor="end"
            className="last-label"
            fill={lastColor}
          >
            {CU.fmtYenSignedAuto(last)}
          </text>
        ) : null}
        {tip ? (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={tip.hx}
              x2={tip.hx}
              y1={padT}
              y2={h - padB}
              stroke="var(--ink-3)"
              strokeWidth="1"
              strokeDasharray="2 3"
            ></line>
            <circle cx={tip.hx} cy={tip.hy} r="4" fill="var(--card)" stroke={tip.dotColor} strokeWidth="2"></circle>
            {/* ツールチップ面は不透明な --bg を使う(半透明の --card だと下の線が透けて読みにくい) */}
            <rect
              x={tip.bx}
              y={tip.by}
              width={tip.boxW}
              height={tip.boxH}
              rx="7"
              fill="var(--bg)"
              stroke="var(--line)"
            ></rect>
            {tip.lines.map((l, i) => (
              <text key={i} x={tip.bx + 10} y={tip.by + 16 + i * 16} className={l.cls} fill={l.c || undefined}>
                {l.t}
              </text>
            ))}
          </g>
        ) : null}
      </svg>
    </div>
  )
}

// 最終収支の分布ヒストグラム(モンテカルロ統計用)
// 大当たりの外れ値で潰れないよう、表示範囲はパーセンタイルで決め、範囲外は端のビンに集約する
export function Histogram({ values, median }: { values: number[]; median: number | null }) {
  const [ref, w] = useMeasure()
  const h = 170
  if (!values || values.length === 0) return null
  const padL = 8,
    padR = 8,
    padT = 8,
    padB = 22

  const sorted = values.slice().sort((a, b) => a - b)
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]
  // 中心の95%とゼロを含む範囲を表示レンジにする
  let mn = Math.min(0, q(0.025))
  let mx = Math.max(0, q(0.975))
  if (mn === mx) {
    mn -= 1
    mx += 1
  }
  const span = mx - mn
  mn -= span * 0.04
  mx += span * 0.04

  const bins = Math.max(10, Math.min(28, Math.floor((w - padL - padR) / 26)))
  const counts: number[] = Array.from({ length: bins }, () => 0)
  let loOut = 0,
    hiOut = 0
  let hiMax: number | null = null,
    loMin: number | null = null
  for (const v of sorted) {
    if (v < mn) {
      loOut++
      counts[0]++
      if (loMin == null) loMin = v
      continue
    }
    if (v > mx) {
      hiOut++
      counts[bins - 1]++
      hiMax = v
      continue
    }
    let bi = Math.floor(((v - mn) / (mx - mn)) * bins)
    if (bi >= bins) bi = bins - 1
    if (bi < 0) bi = 0
    counts[bi]++
  }
  const maxC = Math.max(...counts, 1)
  const bw = (w - padL - padR) / bins
  const XV = (v: number): number => padL + ((v - mn) / (mx - mn)) * (w - padL - padR)
  const X0 = XV(0)
  const Xm = median != null ? Math.max(padL, Math.min(w - padR, XV(median))) : null
  // ラベル衝突回避: ±0と中央値が近すぎる場合や端に寄りすぎる場合は文字を間引く
  const zeroLabelOk = X0 > padL + 34 && X0 < w - padR - 34
  const medLabelOk = Xm != null && Math.abs(Xm - X0) > 30
  return (
    <div ref={ref} className="chart-wrap">
      <svg
        viewBox={'0 0 ' + w + ' ' + h}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="最終収支の分布"
      >
        {counts.map((c, i) => {
          const bh = (c / maxC) * (h - padT - padB)
          const center = mn + ((i + 0.5) / bins) * (mx - mn)
          const isOut = (i === 0 && loOut > 0) || (i === bins - 1 && hiOut > 0)
          return (
            <rect
              key={i}
              x={padL + i * bw + 1}
              y={h - padB - bh}
              width={Math.max(1, bw - 2)}
              height={bh}
              rx="2"
              fill={center >= 0 ? 'var(--pos)' : 'var(--neg)'}
              opacity={isOut ? 0.45 : 0.75}
            ></rect>
          )
        })}
        <line x1={X0} x2={X0} y1={padT} y2={h - padB} stroke="var(--ink-3)" strokeWidth="1"></line>
        {zeroLabelOk ? (
          <text x={X0} y={h - 8} textAnchor="middle" className="tick-label">
            ±0
          </text>
        ) : null}
        {Xm != null ? (
          <g>
            <line
              x1={Xm}
              x2={Xm}
              y1={padT}
              y2={h - padB}
              stroke="var(--ink)"
              strokeWidth="1.2"
              strokeDasharray="4 3"
            ></line>
            {medLabelOk ? (
              <text
                x={Xm + (Xm > w / 2 ? -4 : 4)}
                y={padT + 10}
                textAnchor={Xm > w / 2 ? 'end' : 'start'}
                className="tick-label"
              >
                中央値
              </text>
            ) : null}
          </g>
        ) : null}
        <text x={padL} y={h - 8} textAnchor="start" className="tick-label">
          {CU.fmtYenShort(mn)}
        </text>
        <text x={w - padR} y={h - 8} textAnchor="end" className="tick-label">
          {CU.fmtYenShort(mx)}
        </text>
      </svg>
      {hiOut > 0 || loOut > 0 ? (
        <p className="hist-note">
          {hiOut > 0
            ? '表示範囲超の大当たり ' + hiOut + '件(最大 ' + CU.fmtYenSignedAuto(hiMax as number) + ')を右端に集約'
            : ''}
          {hiOut > 0 && loOut > 0 ? ' / ' : ''}
          {loOut > 0
            ? '範囲外のマイナス ' + loOut + '件(最小 ' + CU.fmtYenSignedAuto(loMin as number) + ')を左端に集約'
            : ''}
        </p>
      ) : null}
    </div>
  )
}

// 当選等級の内訳
export function TierTable({
  game,
  tierCounts,
  tierAmounts,
  totalTickets,
}: {
  game: Game
  tierCounts: Record<string, number> | null
  tierAmounts: Record<string, number> | null
  totalTickets: number
}) {
  const amounts = game.tiers.map((t) => (tierAmounts && tierAmounts[t.label]) || 0)
  const maxAmt = Math.max(1, ...amounts)
  return (
    <div className="tier-table" role="table" aria-label="当選等級の内訳">
      <div className="tier-head" role="row">
        <span role="columnheader">等級</span>
        <span role="columnheader">賞金</span>
        <span role="columnheader">確率</span>
        <span className="ta-r" role="columnheader">
          当選
        </span>
        <span className="ta-r" role="columnheader">
          獲得額
        </span>
      </div>
      {game.tiers.map((tier, i) => {
        const count = (tierCounts && tierCounts[tier.label]) || 0
        const amt = amounts[i]
        const pct = amt > 0 ? Math.max(1.5, Math.sqrt(amt / maxAmt) * 100) : 0
        const exp = ((totalTickets || 0) * tier.n) / tier.d
        const expTitle = totalTickets
          ? '理論上の期待当選数: 約' +
            (exp >= 10 ? Math.round(exp).toLocaleString('ja-JP') : exp.toFixed(exp >= 0.1 ? 1 : 4)) +
            '本'
          : undefined
        return (
          <div className={'tier-row' + (count > 0 ? ' hit' : '')} key={tier.label} title={expTitle} role="row">
            {/* role=presentation でレイアウト用 div を a11y ツリーから外し、セルを行直下に昇格させる */}
            <div className="tier-line" role="presentation">
              <span className="tier-label" role="cell">
                {tier.label}
              </span>
              <span className="tier-prize num" role="cell">
                {CU.fmtYenShort(tier.prize)}
              </span>
              <span className="tier-prob num" role="cell">
                {CU.fmtProb(tier)}
              </span>
              <span className="tier-count num ta-r" role="cell">
                {count > 0 ? '×' + count.toLocaleString('ja-JP') : '—'}
                {expTitle ? <span className="sr-only">({expTitle})</span> : null}
              </span>
              <span className="tier-amt num ta-r" role="cell">
                {count > 0 ? CU.fmtYenAuto(amt) : ''}
              </span>
            </div>
            <div className="tier-bar" aria-hidden="true">
              <i style={{ width: pct + '%' }}></i>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// 投資額 vs 回収額
export function CompareBars({ invest, ret, accent }: { invest: number; ret: number; accent: string }) {
  const max = Math.max(invest, ret, 1)
  const rows = [
    { label: '投資額', value: invest, color: 'var(--ink-2)' },
    { label: '回収額', value: ret, color: accent },
  ]
  return (
    <div className="compare-bars">
      {rows.map((r) => (
        <div className="cmp-row" key={r.label}>
          <div className="cmp-line">
            <span className="cmp-label">{r.label}</span>
            <span className="cmp-value num">{CU.fmtYenAuto(r.value)}</span>
          </div>
          <div className="cmp-track">
            <i style={{ width: (r.value / max) * 100 + '%', background: r.color }}></i>
          </div>
        </div>
      ))}
      <div className="cmp-foot">
        回収率 <strong className="num">{invest > 0 ? ((ret / invest) * 100).toFixed(1) : '0.0'}%</strong>
      </div>
    </div>
  )
}

// モンテカルロのファンチャート — 収支推移のパーセンタイル帯(5/25/50/75/95)を時間軸に重ねる。
// bands[k] = [p5, p25, p50, p75, p95]、xs[k] = その点の経過年数。
export function FanChart({ xs, bands, yearsTotal }: { xs: number[]; bands: number[][]; yearsTotal: number }) {
  const [ref, w] = useMeasure()
  const h = 220
  if (!bands || bands.length === 0) return null
  const padL = 64,
    padR = 14,
    padT = 12,
    padB = 24
  const plotW = Math.max(1, w - padL - padR)

  let minY = 0,
    maxY = 0
  for (const b of bands) {
    if (b[0] < minY) minY = b[0]
    if (b[4] > maxY) maxY = b[4]
  }
  if (minY === 0 && maxY === 0) maxY = 1000
  const range = maxY - minY || 1
  minY -= range * 0.06
  maxY += range * 0.06

  const X = (yr: number): number => padL + (yearsTotal > 0 ? yr / yearsTotal : 0) * plotW
  const Y = (v: number): number => padT + ((maxY - v) / (maxY - minY)) * (h - padT - padB)

  // 帯のエリアパス(上の系列を順方向、下の系列を逆方向に閉じる)
  const bandPath = (hiIdx: number, loIdx: number): string => {
    const top = bands.map((b, k) => (k === 0 ? 'M' : 'L') + X(xs[k]).toFixed(1) + ',' + Y(b[hiIdx]).toFixed(1))
    const bot = []
    for (let k = bands.length - 1; k >= 0; k--)
      bot.push('L' + X(xs[k]).toFixed(1) + ',' + Y(bands[k][loIdx]).toFixed(1))
    return top.join(' ') + ' ' + bot.join(' ') + ' Z'
  }
  const median = bands.map((b, k) => (k === 0 ? 'M' : 'L') + X(xs[k]).toFixed(1) + ',' + Y(b[2]).toFixed(1)).join(' ')

  const yTicks = niceTicks(minY, maxY, 5)
  const xTicks = niceTicks(0, yearsTotal, 5).filter((v) => v >= 0 && v <= yearsTotal)
  const medLast = bands[bands.length - 1][2]

  return (
    <div ref={ref} className="chart-wrap">
      <div className="chart-legend">
        <span className="lg-item">
          <i className="lg-line" style={{ background: 'var(--ink)' }}></i>中央値
        </span>
        <span className="lg-item">
          <i className="lg-band band-50"></i>25–75%
        </span>
        <span className="lg-item">
          <i className="lg-band band-90"></i>5–95%
        </span>
      </div>
      <svg width={w} height={h} role="img" aria-label="収支推移のパーセンタイル分布(ファンチャート)">
        {yTicks.map((v, i) => (
          <g key={'y' + i}>
            <line x1={padL} x2={w - padR} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" strokeWidth="1"></line>
            <text x={padL - 8} y={Y(v) + 4} textAnchor="end" className="tick-label">
              {CU.fmtYenShort(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text key={'x' + i} x={X(v)} y={h - 7} textAnchor={i === 0 ? 'start' : 'middle'} className="tick-label">
            {v.toLocaleString('ja-JP')}
            {i === xTicks.length - 1 ? '年' : ''}
          </text>
        ))}
        <path d={bandPath(0, 4)} fill="var(--ink)" opacity="0.08"></path>
        <path d={bandPath(1, 3)} fill="var(--ink)" opacity="0.16"></path>
        <line
          x1={padL}
          x2={w - padR}
          y1={Y(0)}
          y2={Y(0)}
          stroke="var(--ink-3)"
          strokeWidth="1"
          strokeDasharray="3 3"
        ></line>
        <path d={median} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round"></path>
        <circle
          cx={X(xs[xs.length - 1])}
          cy={Y(medLast)}
          r="3.5"
          fill={medLast >= 0 ? 'var(--pos)' : 'var(--neg)'}
        ></circle>
      </svg>
    </div>
  )
}
