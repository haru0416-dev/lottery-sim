// 表示設定パネル(Tweaks)
// 元はデザインツールのホストプロトコル(postMessage 連携)だったが、スタンドアロン用に
// localStorage 永続化 + 画面内トグル(FAB)へ置き換えた。フローティングシェルと
// フォームコントロール群はそのまま流用している。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const __TWEAKS_STYLE = `
  .twk-fab{position:fixed;right:16px;bottom:16px;z-index:2147483645;appearance:none;
    border:1px solid rgba(33,29,25,.5);background:#fefdfc;
    color:#211d19;border-radius:2px;height:38px;padding:0 16px;cursor:pointer;
    font:600 12.5px/1 'IBM Plex Sans JP',ui-sans-serif,system-ui,sans-serif;
    box-shadow:2px 2px 0 rgba(33,29,25,.18);display:flex;align-items:center;gap:6px}
  .twk-fab:hover{background:#f4f1ee}

  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);
    display:flex;flex-direction:column;
    background:#fefdfc;color:#211d19;
    border:1px solid rgba(33,29,25,.5);border-radius:2px;
    box-shadow:2px 2px 0 rgba(33,29,25,.18);
    font:11.5px/1.4 'IBM Plex Sans JP',ui-sans-serif,system-ui,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  /* background-color を使う(ショートハンドだと select のチェブロン背景が
     repeat:repeat に戻りタイル状に敷き詰められて壊れる) */
  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background-color:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background-color:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:pointer}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:pointer}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:pointer;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:pointer;padding:0}
  .twk-toggle[data-on="1"]{background:#211d19}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:pointer;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:pointer;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}

  /* ── ダークモード(夜の帳簿 — アプリの data-theme と連動) ── */
  [data-theme="dark"] .twk-fab{background:#1b1815;border-color:rgba(240,236,229,.4);color:#f0ece5;
    box-shadow:2px 2px 0 rgba(0,0,0,.45)}
  [data-theme="dark"] .twk-fab:hover{background:#252119}
  [data-theme="dark"] .twk-panel{background:#1b1815;color:#f0ece5;
    border-color:rgba(240,236,229,.4);
    box-shadow:2px 2px 0 rgba(0,0,0,.45)}
  [data-theme="dark"] .twk-x{color:rgba(240,236,229,.55)}
  [data-theme="dark"] .twk-x:hover{background:rgba(255,255,255,.08);color:#f0ece5}
  [data-theme="dark"] .twk-body{scrollbar-color:rgba(255,255,255,.2) transparent}
  [data-theme="dark"] .twk-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);
    border:2px solid transparent;background-clip:content-box}
  [data-theme="dark"] .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.3);
    border:2px solid transparent;background-clip:content-box}
  [data-theme="dark"] .twk-lbl{color:rgba(240,236,229,.75)}
  [data-theme="dark"] .twk-val{color:rgba(240,236,229,.5)}
  [data-theme="dark"] .twk-sect{color:rgba(240,236,229,.45)}
  [data-theme="dark"] .twk-field{border-color:rgba(255,255,255,.14);background-color:rgba(255,255,255,.08)}
  [data-theme="dark"] .twk-field:focus{border-color:rgba(255,255,255,.3);background-color:rgba(255,255,255,.12)}
  [data-theme="dark"] select.twk-field{
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(255,255,255,.6)' d='M0 0h10L5 6z'/></svg>")}
  [data-theme="dark"] .twk-slider{background:rgba(255,255,255,.18)}
  [data-theme="dark"] .twk-seg{background:rgba(255,255,255,.1)}
  [data-theme="dark"] .twk-seg-thumb{background:rgba(96,90,80,.95);box-shadow:0 1px 2px rgba(0,0,0,.4)}
  [data-theme="dark"] .twk-toggle{background:rgba(255,255,255,.22)}
  [data-theme="dark"] .twk-toggle[data-on="1"]{background:#d9d2c7}
  [data-theme="dark"] .twk-toggle[data-on="1"] i{box-shadow:0 1px 2px rgba(0,0,0,.4)}
`

const TWEAKS_KEY = 'lotterySim.tweaks.v1'

function loadTweaks<T extends object>(defaults: T): T {
  try {
    const raw = localStorage.getItem(TWEAKS_KEY)
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    /* ignore */
  }
  return defaults
}

// ── useTweaks ───────────────────────────────────────────────────────────────
// Tweak 値の単一の真実。setTweak は localStorage に永続化する
// (元はホストへ postMessage していた部分の置き換え)。
export type SetTweak<T> = (keyOrEdits: keyof T | Partial<T>, val?: T[keyof T]) => void

export function useTweaks<T extends object>(defaults: T): [T, SetTweak<T>] {
  const [values, setValues] = useState<T>(() => loadTweaks(defaults))
  const setTweak = useCallback<SetTweak<T>>((keyOrEdits, val) => {
    const edits =
      typeof keyOrEdits === 'object' && keyOrEdits !== null
        ? (keyOrEdits as Partial<T>)
        : ({ [keyOrEdits as keyof T]: val } as Partial<T>)
    setValues((prev) => {
      const next = { ...prev, ...edits }
      try {
        localStorage.setItem(TWEAKS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])
  return [values, setTweak]
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// フローティングシェル + 画面内トグル(FAB)。ドラッグで移動でき、ビューポート内に
// クランプされる。
export function TweaksPanel({ title = '表示設定', children }: { title?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const dragRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef({ x: 16, y: 16 })
  const PAD = 16

  const clampToViewport = useCallback(() => {
    const panel = dragRef.current
    if (!panel) return
    const w = panel.offsetWidth,
      h = panel.offsetHeight
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD)
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD)
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    }
    panel.style.right = offsetRef.current.x + 'px'
    panel.style.bottom = offsetRef.current.y + 'px'
  }, [])

  useEffect(() => {
    if (!open) return
    clampToViewport()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport)
      return () => window.removeEventListener('resize', clampToViewport)
    }
    const ro = new ResizeObserver(clampToViewport)
    ro.observe(document.documentElement)
    return () => ro.disconnect()
  }, [open, clampToViewport])

  const onDragStart = (e: React.MouseEvent) => {
    const panel = dragRef.current
    if (!panel) return
    const r = panel.getBoundingClientRect()
    const sx = e.clientX,
      sy = e.clientY
    const startRight = window.innerWidth - r.right
    const startBottom = window.innerHeight - r.bottom
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      }
      clampToViewport()
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <>
      <style>{__TWEAKS_STYLE}</style>
      {!open ? (
        <button type="button" className="twk-fab" onClick={() => setOpen(true)} aria-label="表示設定を開く">
          ⚙ 表示設定
        </button>
      ) : null}
      {open ? (
        <div ref={dragRef} className="twk-panel" style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}>
          <div className="twk-hd" onMouseDown={onDragStart}>
            <b>{title}</b>
            <button
              className="twk-x"
              aria-label="表示設定を閉じる"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="twk-body">{children}</div>
        </div>
      ) : null}
    </>
  )
}

// ── Layout helpers ──────────────────────────────────────────────────────────

export function TweakSection({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <>
      <div className="twk-sect">{label}</div>
      {children}
    </>
  )
}

export function TweakRow({
  label,
  value,
  children,
  inline = false,
}: {
  label: string
  value?: ReactNode
  children?: ReactNode
  inline?: boolean
}) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

export function TweakSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <TweakRow label={label} value={`${value}${unit}`}>
      <input
        type="range"
        className="twk-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={`${value}${unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </TweakRow>
  )
}

export function TweakToggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl">
        <span>{label}</span>
      </div>
      <button
        type="button"
        className="twk-toggle"
        data-on={value ? '1' : '0'}
        role="switch"
        aria-checked={!!value}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </div>
  )
}

type RadioOption = string | { value: string; label: string }

export function TweakRadio({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: RadioOption[]
  onChange: (v: string) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  // ドラッグ中の pointer-move ハンドラから現在値を読むため ref 化(stale closure 回避)
  const valueRef = useRef(value)
  valueRef.current = value

  // セグメントが幅を超えると折り返すので、文字数が閾値を超えたらドロップダウンに退避
  const labelLen = (o: RadioOption) => String(typeof o === 'object' ? o.label : o).length
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0)
  const fitsAsSegments = maxLen <= (({ 2: 16, 3: 10 } as Record<number, number>)[options.length] ?? 0)
  if (!fitsAsSegments) {
    return <TweakSelect label={label} value={value} options={options} onChange={(s) => onChange(s)} />
  }
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }))
  const idx = Math.max(
    0,
    opts.findIndex((o) => o.value === value),
  )
  const n = opts.length

  const segAt = (clientX: number): string => {
    const r = trackRef.current!.getBoundingClientRect()
    const inner = r.width - 4
    const i = Math.floor(((clientX - r.left - 2) / inner) * n)
    return opts[Math.max(0, Math.min(n - 1, i))].value
  }

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true)
    const v0 = segAt(e.clientX)
    if (v0 !== valueRef.current) onChange(v0)
    const move = (ev: PointerEvent) => {
      if (!trackRef.current) return
      const v = segAt(ev.clientX)
      if (v !== valueRef.current) onChange(v)
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <TweakRow label={label}>
      <div
        ref={trackRef}
        role="radiogroup"
        onPointerDown={onPointerDown}
        className={dragging ? 'twk-seg dragging' : 'twk-seg'}
      >
        <div
          className="twk-seg-thumb"
          style={{
            left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
            width: `calc((100% - 4px) / ${n})`,
          }}
        />
        {opts.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}>
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  )
}

export function TweakSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: RadioOption[]
  onChange: (v: string) => void
}) {
  return (
    <TweakRow label={label}>
      <select className="twk-field" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o
          const l = typeof o === 'object' ? o.label : o
          return (
            <option key={v} value={v}>
              {l}
            </option>
          )
        })}
      </select>
    </TweakRow>
  )
}

// 相対輝度でチェックマーク色を選ぶ(#rgb / #rrggbb のみ。それ以外は light 扱い)
function __twkIsLight(hex: string): boolean {
  const h = String(hex).replace('#', '')
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0')
  const n = parseInt(x.slice(0, 6), 16)
  if (Number.isNaN(n)) return true
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255
  return r * 299 + g * 587 + b * 114 > 148000
}

const __TwkCheck = ({ light }: { light: boolean }) => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M3 7.2 5.8 10 11 4.2"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      stroke={light ? 'rgba(0,0,0,.78)' : '#fff'}
    />
  </svg>
)

type ColorOption = string | string[]

// TweakColor — キュレートしたカラー/パレットピッカー。各オプションは hex 文字列か
// hex 配列。onChange は渡された形のまま emit する。
export function TweakColor({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: ColorOption
  options?: ColorOption[]
  onChange: (v: ColorOption) => void
}) {
  if (!options || !options.length) {
    return (
      <div className="twk-row twk-row-h">
        <div className="twk-lbl">
          <span>{label}</span>
        </div>
        <input
          type="color"
          className="twk-swatch"
          value={value as string}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }
  const key = (o: ColorOption) => String(JSON.stringify(o)).toLowerCase()
  const cur = key(value)
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((o, i) => {
          const colors = Array.isArray(o) ? o : [o]
          const [hero, ...rest] = colors
          const sup = rest.slice(0, 4)
          const on = key(o) === cur
          return (
            <button
              key={i}
              type="button"
              className="twk-chip"
              role="radio"
              aria-checked={on}
              data-on={on ? '1' : '0'}
              aria-label={colors.join(', ')}
              title={colors.join(' · ')}
              style={{ background: hero }}
              onClick={() => onChange(o)}
            >
              {sup.length > 0 && (
                <span>
                  {sup.map((c, j) => (
                    <i key={j} style={{ background: c }} />
                  ))}
                </span>
              )}
              {on && <__TwkCheck light={__twkIsLight(hero)} />}
            </button>
          )
        })}
      </div>
    </TweakRow>
  )
}
