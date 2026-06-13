// シミュレーション用 Web Worker — 重いバッチ計算(一括・モンテカルロ)を主スレッドから逃がす。
// 純ロジック(sim-engine / lottery-data)のみ使用。DOM 非依存。
import { effGameOf } from './lottery-data.ts'
import { runBulkSim, runOneTrial } from './sim-engine.ts'
import type { DoDrawOpts } from './types.ts'

interface BulkReq {
  kind: 'bulk'
  reqId: number
  gameId: string
  betType: string
  tickets: number
  totalDraws: number
  opts: DoDrawOpts
  cmp: { gameId: string; betType: string; tickets: number; totalDraws: number; opts: DoDrawOpts } | null
}

interface MCReq {
  kind: 'mc'
  reqId: number
  gameId: string
  betType: string
  tickets: number
  totalDraws: number
  opts: DoDrawOpts
  trials: number
  bankroll: number
  sampleAt: number[]
}

type Req = BulkReq | MCReq

const bulkOf = (gameId: string, betType: string, tickets: number, totalDraws: number, opts: DoDrawOpts) =>
  runBulkSim(effGameOf(gameId, betType), tickets, totalDraws, opts)

self.onmessage = (e: MessageEvent<Req>) => {
  const msg = e.data
  if (msg.kind === 'bulk') {
    const sim = bulkOf(msg.gameId, msg.betType, msg.tickets, msg.totalDraws, msg.opts)
    const cmp = msg.cmp
      ? bulkOf(msg.cmp.gameId, msg.cmp.betType, msg.cmp.tickets, msg.cmp.totalDraws, msg.cmp.opts)
      : null
    self.postMessage({ reqId: msg.reqId, kind: 'bulk-done', sim, cmp })
    return
  }
  if (msg.kind === 'mc') {
    const game = effGameOf(msg.gameId, msg.betType)
    const opts: DoDrawOpts = Object.assign({}, msg.opts, { lite: true })
    const finals: number[] = []
    const trajectories: number[][] = []
    const survival: number[] = []
    let winSum = 0
    let costSum = 0
    let ruinCount = 0
    let lastPost = 0
    for (let t = 0; t < msg.trials; t++) {
      const o = runOneTrial(game, msg.tickets, msg.totalDraws, opts, msg.bankroll, msg.sampleAt)
      finals.push(o.final)
      trajectories.push(o.traj)
      survival.push(o.ruinDraw)
      winSum += o.win
      costSum += o.cost
      if (o.ruined) ruinCount++
      // 進捗を ~80ms 間隔で通知(過剰なメッセージを避ける)
      const now = Date.now()
      if (now - lastPost >= 80) {
        lastPost = now
        self.postMessage({ reqId: msg.reqId, kind: 'mc-progress', done: t + 1 })
      }
    }
    self.postMessage({
      reqId: msg.reqId,
      kind: 'mc-done',
      raw: { finals, trajectories, survival, winSum, costSum, ruinCount },
    })
    return
  }
}
