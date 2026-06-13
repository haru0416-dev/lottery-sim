// メインスレッド側のシミュレーション実行API。
// 重いバッチ(一括・モンテカルロ)を Web Worker に逃がし、ワーカー不可環境では
// 同期/逐次のフォールバックに切り替える。アニメ/チェイスは主スレッド据え置き(別)。
import { effGameOf } from './lottery-data.ts'
import { runBulkSim, runOneTrial } from './sim-engine.ts'
import type { DoDrawOpts, SimState } from './types.ts'

const workerSupported = typeof Worker !== 'undefined'

function makeWorker(): Worker {
  return new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
}

export interface BulkParams {
  gameId: string
  betType: string
  tickets: number
  totalDraws: number
  opts: DoDrawOpts
  cmp: { gameId: string; betType: string; tickets: number; totalDraws: number; opts: DoDrawOpts } | null
}

export interface BulkResult {
  sim: SimState
  cmp: SimState | null
}

// 一括: ワーカーで実行。失敗/非対応時は主スレッドで同期実行(短時間)にフォールバック。
export function runBulk(p: BulkParams): Promise<BulkResult> {
  if (!workerSupported) return Promise.resolve(runBulkSync(p))
  return new Promise<BulkResult>((resolve) => {
    let w: Worker
    try {
      w = makeWorker()
    } catch {
      resolve(runBulkSync(p))
      return
    }
    let settled = false
    const done = (r: BulkResult) => {
      if (settled) return
      settled = true
      w.terminate()
      resolve(r)
    }
    w.onmessage = (e) => done({ sim: e.data.sim, cmp: e.data.cmp })
    w.onerror = () => done(runBulkSync(p)) // ワーカー失敗時は同期で
    w.postMessage({ kind: 'bulk', reqId: 1, ...p })
  })
}

function runBulkSync(p: BulkParams): BulkResult {
  const one = (gameId: string, betType: string, tk: number, td: number, opts: DoDrawOpts): SimState =>
    runBulkSim(effGameOf(gameId, betType), tk, td, opts)
  return {
    sim: one(p.gameId, p.betType, p.tickets, p.totalDraws, p.opts),
    cmp: p.cmp ? one(p.cmp.gameId, p.cmp.betType, p.cmp.tickets, p.cmp.totalDraws, p.cmp.opts) : null,
  }
}

export interface MCRaw {
  finals: number[]
  trajectories: number[][]
  survival: number[]
  winSum: number
  costSum: number
  ruinCount: number
}

export interface MCParams {
  gameId: string
  betType: string
  tickets: number
  totalDraws: number
  opts: DoDrawOpts
  trials: number
  bankroll: number
  sampleAt: number[]
}

export interface MCHandle {
  promise: Promise<MCRaw | null> // キャンセル時は null
  cancel: () => void
}

function emptyRaw(): MCRaw {
  return { finals: [], trajectories: [], survival: [], winSum: 0, costSum: 0, ruinCount: 0 }
}

function mergeRaw(parts: MCRaw[]): MCRaw {
  const out = emptyRaw()
  for (const r of parts) {
    out.finals.push(...r.finals)
    out.trajectories.push(...r.trajectories)
    out.survival.push(...r.survival)
    out.winSum += r.winSum
    out.costSum += r.costSum
    out.ruinCount += r.ruinCount
  }
  return out
}

// モンテカルロ: コア数に応じて試行をワーカープールで分割並列。
// onProgress(done, total) を ~80ms 間隔で通知。cancel() で全ワーカー停止。
export function runMonteCarlo(p: MCParams, onProgress: (done: number, total: number) => void): MCHandle {
  if (!workerSupported) return runMonteCarloSync(p, onProgress)

  const cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
  const n = Math.max(1, Math.min(cores, p.trials))
  const base = Math.floor(p.trials / n)
  const shares: number[] = Array.from({ length: n }, (_, i) => base + (i < p.trials % n ? 1 : 0)).filter((x) => x > 0)

  const workers: Worker[] = []
  let cancelled = false
  const cancel = () => {
    cancelled = true
    for (const w of workers) w.terminate()
  }

  const progress: number[] = shares.map(() => 0)
  const total = p.trials

  const promise = new Promise<MCRaw | null>((resolve) => {
    const parts: (MCRaw | null)[] = shares.map(() => null)
    let remaining = shares.length
    let failed = false

    shares.forEach((share, idx) => {
      let w: Worker
      try {
        w = makeWorker()
      } catch {
        failed = true
        return
      }
      workers.push(w)
      w.onmessage = (e) => {
        const d = e.data
        if (d.kind === 'mc-progress') {
          progress[idx] = d.done
          onProgress(
            progress.reduce((a, b) => a + b, 0),
            total,
          )
        } else if (d.kind === 'mc-done') {
          parts[idx] = d.raw as MCRaw
          progress[idx] = share
          w.terminate()
          remaining--
          if (remaining === 0 && !cancelled) {
            onProgress(total, total)
            resolve(mergeRaw(parts.filter((x): x is MCRaw => x != null)))
          }
        }
      }
      w.onerror = () => {
        // 1つでも失敗したら全停止して同期にフォールバック(結果の一貫性のため)
        if (failed) return
        failed = true
        cancel()
        cancelled = false
        runMonteCarloSync(p, onProgress).promise.then(resolve)
      }
      w.postMessage({
        kind: 'mc',
        reqId: idx,
        gameId: p.gameId,
        betType: p.betType,
        tickets: p.tickets,
        totalDraws: p.totalDraws,
        opts: p.opts,
        trials: share,
        bankroll: p.bankroll,
        sampleAt: p.sampleAt,
      })
    })

    // 全ワーカー生成に失敗した場合は同期へ
    if (failed && workers.length === 0) {
      runMonteCarloSync(p, onProgress).promise.then(resolve)
    }
  })

  return { promise, cancel }
}

// 同期/逐次フォールバック(setTimeoutチャンクで主スレッドを長時間ブロックしない)
function runMonteCarloSync(p: MCParams, onProgress: (done: number, total: number) => void): MCHandle {
  const game = effGameOf(p.gameId, p.betType)
  const opts: DoDrawOpts = Object.assign({}, p.opts, { lite: true })
  const raw = emptyRaw()
  let cancelled = false
  const promise = new Promise<MCRaw | null>((resolve) => {
    let idx = 0
    const step = () => {
      if (cancelled) {
        resolve(null)
        return
      }
      const t0 = performance.now()
      while (idx < p.trials && performance.now() - t0 < 16) {
        const o = runOneTrial(game, p.tickets, p.totalDraws, opts, p.bankroll, p.sampleAt)
        raw.finals.push(o.final)
        raw.trajectories.push(o.traj)
        raw.survival.push(o.ruinDraw)
        raw.winSum += o.win
        raw.costSum += o.cost
        if (o.ruined) raw.ruinCount++
        idx++
      }
      onProgress(idx, p.trials)
      if (idx >= p.trials) resolve(raw)
      else setTimeout(step, 0)
    }
    setTimeout(step, 0)
  })
  return { promise, cancel: () => (cancelled = true) }
}
