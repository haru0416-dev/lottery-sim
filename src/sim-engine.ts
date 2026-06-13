// シミュレーションエンジン — UIなしの純ロジック(App と MultiTrialPanel で共用)

import type { DoDrawOpts, Game, SimState, Tier } from './types.ts'

export const LOG_CAP = 120
export const HIGH_CAP = 300
export const BAL_CAP = 8192

export function newSim(): SimState {
  return {
    n: 0,
    cost: 0,
    win: 0,
    winCount: 0,
    balances: [],
    balStride: 1,
    carry: 0,
    firstJackpotAt: null,
    jackpotPrize: 0,
    costAtJackpot: 0,
    bestPrize: 0,
    bestLabel: null,
    bestAt: 0,
    tierCounts: {},
    tierAmounts: {},
    log: [],
    highs: [],
    highsTotal: 0,
  }
}

// 物理抽せん用: 1..pool から count 個を重複なく抽出(部分Fisher-Yates)。
// プール配列は pool ごとにキャッシュ(比較並走で異なる pool を交互に引いても再生成しない)。
const POOL_CACHE = new Map<number, number[]>()
export function drawFrom(pool: number, count: number): number[] {
  let buf = POOL_CACHE.get(pool)
  if (!buf) {
    buf = []
    for (let i = 1; i <= pool; i++) buf.push(i)
    POOL_CACHE.set(pool, buf)
  }
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (pool - i))
    const tmp = buf[i]
    buf[i] = buf[j]
    buf[j] = tmp
  }
  return buf.slice(0, count)
}

// 1回分の抽せん(購入)を実行。opts.lite=true でグラフ/ログ/ハイライト記録を省略(統計試行用)
export function doDraw(game: Game, tickets: number, S: SimState, opts?: DoDrawOpts): void {
  const lite = !!(opts && opts.lite)
  const drawIdx = S.n + 1
  let win = 0
  let best: { label: string; prize: number } | null = null
  let nums: { main: number[]; bonus: number[] } | null = null
  let hitJackpot = false

  // キャリーオーバー適用後の1等賞金
  const carryCfg = opts && opts.carryOn && game.carry ? game.carry : null
  const tier0Prize = carryCfg ? Math.min(carryCfg.cap, game.tiers[0].prize + S.carry) : game.tiers[0].prize

  const applyHit = (tier: Tier, count: number, prizeEach?: number | null) => {
    const p = prizeEach != null ? prizeEach : tier.prize
    win += p * count
    S.winCount += count
    S.tierCounts[tier.label] = (S.tierCounts[tier.label] || 0) + count
    S.tierAmounts[tier.label] = (S.tierAmounts[tier.label] || 0) + p * count
    if (!best || p > best.prize) best = { label: tier.label, prize: p }
    const tot = p * count
    if (tot > S.bestPrize) {
      S.bestPrize = tot
      S.bestLabel = tier.label
      S.bestAt = drawIdx
    }
    if (tier === game.tiers[0]) {
      hitJackpot = true
      if (!S.firstJackpotAt) {
        S.firstJackpotAt = drawIdx
        S.jackpotPrize = p * count
        S.costAtJackpot = S.cost + game.price * tickets
      }
    }
    if (!lite && p >= 10000) {
      S.highsTotal += count
      if (S.highs.length < HIGH_CAP) S.highs.push({ i: drawIdx, label: tier.label, prize: p, count: count })
    }
  }

  // 確率テーブルを1枚ロール(skip指定の等級を除外)
  const rollOnce = (skipSet: Set<number> | null): number => {
    let r = Math.random()
    for (let j = 0; j < game.tiers.length; j++) {
      if (skipSet && skipSet.has(j)) continue
      const tier = game.tiers[j]
      const p = tier.n / tier.d
      if (r < p) return j
      r -= p
    }
    return -1
  }

  if (game.lotto) {
    // 物理抽せん: 本数字+ボーナス数字を実際に抽出して照合
    const L = game.lotto
    const drawn = drawFrom(L.pool, L.pick + L.bonus)
    const main = drawn.slice(0, L.pick).sort((a, b) => a - b)
    const bonus = drawn.slice(L.pick, L.pick + L.bonus)
    nums = { main: main, bonus: bonus }
    const mainSet = new Set(main)
    const bonusSet = new Set(bonus)
    const countMatch = (ticket: number[]): number => {
      let m = 0
      let bb = 0
      for (let v = 0; v < ticket.length; v++) {
        if (mainSet.has(ticket[v])) m++
        else if (bonusSet.has(ticket[v])) bb++
      }
      return L.tierOf(m, bb)
    }
    if (opts && opts.mode === 'fixed' && opts.fixed && opts.fixed.length === L.pick) {
      // 固定数字 × 口数 — 全等級パリミュチュエル(山分け)を考慮:
      // 1等: 原資額を自分の口数で山分け(受取総額は原資のまま)
      // 2等以下: 想定販売口数から期待当せん本数Eを推定し、
      //          自分の追加口による希釈 ×E/(E+口数-1) を適用(1口なら公表額どおり)
      const ti = countMatch(opts.fixed)
      if (ti === 0) applyHit(game.tiers[0], tickets, tier0Prize / tickets)
      else if (ti > 0) {
        const tier = game.tiers[ti]
        const E = ((L.sales || 0) * tier.n) / tier.d
        const dilute = E > 0 && tickets > 1 ? E / (E + tickets - 1) : 1
        applyHit(tier, tickets, tier.prize * dilute)
      }
    } else {
      // クイックピック: 毎口ランダム
      for (let k = 0; k < tickets; k++) {
        const ti = countMatch(drawFrom(L.pool, L.pick))
        if (ti >= 0) applyHit(game.tiers[ti], 1, ti === 0 ? tier0Prize : null)
      }
    }
  } else if (game.pack10 && opts && opts.jumboStyle && tickets >= 10) {
    // ジャンボ: バラ/連番(10枚1セット)
    // どちらも下1けた賞(末等)が10枚に1本確定。
    // 連番: 前後賞は独立抽選しないかわりに、1等当選時に前後賞×2を同時獲得(期待値は同一)。
    const T = game.tiers
    const lastIdx = T.length - 1 // 7等(下1けた)
    const renban = opts.jumboStyle === 'renban'
    const skip = new Set<number>(renban ? [lastIdx, 1] : [lastIdx])
    const packs = Math.floor(tickets / 10)
    for (let pk = 0; pk < packs; pk++) {
      applyHit(T[lastIdx], 1) // 下1けた賞 確定
      for (let k = 0; k < 10; k++) {
        const j = rollOnce(skip)
        if (j >= 0) {
          applyHit(T[j], 1, j === 0 ? tier0Prize : null)
          if (j === 0 && renban) applyHit(T[1], 2) // 前後賞×2
        }
      }
    }
    for (let k = packs * 10; k < tickets; k++) {
      const j = rollOnce(null)
      if (j >= 0) applyHit(T[j], 1, j === 0 ? tier0Prize : null)
    }
  } else {
    // 確率テーブルによる抽選
    for (let k = 0; k < tickets; k++) {
      const j = rollOnce(null)
      if (j >= 0) applyHit(game.tiers[j], 1, j === 0 && carryCfg ? tier0Prize : null)
    }
  }

  // キャリーオーバー更新: 自分か全国の誰かが1等を出すとリセット、不出現なら繰越
  if (carryCfg) {
    if (hitJackpot) S.carry = 0
    else if (Math.random() < carryCfg.pNoWin)
      S.carry = Math.min(carryCfg.cap - game.tiers[0].prize, S.carry + carryCfg.add)
    else S.carry = 0
  }

  const cost = game.price * tickets
  S.cost += cost
  S.win += win
  S.n = drawIdx
  if (!lite) {
    // 長期ラン用に間引き保存(ストライド倍増)
    if (drawIdx % S.balStride === 0) {
      S.balances.push(S.win - S.cost)
      if (S.balances.length >= BAL_CAP) {
        S.balances = S.balances.filter((_, i) => i % 2 === 1)
        S.balStride *= 2
      }
    }
    const bestSnap = best as { label: string; prize: number } | null
    S.log.push({
      i: drawIdx,
      tickets: tickets,
      cost: cost,
      win: win,
      best: bestSnap ? bestSnap.label : null,
      nums: nums,
    })
    if (S.log.length > LOG_CAP) S.log.shift()
  }
}

// 一括シミュレーション(全 totalDraws を回し切る)。worker と同期フォールバックで共用。
export function runBulkSim(game: Game, tickets: number, totalDraws: number, opts: DoDrawOpts): SimState {
  const S = newSim()
  for (let i = 0; i < totalDraws; i++) doDraw(game, tickets, S, opts)
  return S
}

// モンテカルロの1試行(純ロジック)。軌跡(各サンプル点の収支)・破産・収支合計を返す。
// 元手 bankroll>0 のとき、次回分を買えなくなったら破産として打ち切る。
// worker と同期フォールバックの両方から呼ぶ共有プリミティブ。
export interface TrialOutcome {
  final: number
  traj: number[] // 長さ sampleAt.length
  ruined: boolean
  ruinDraw: number // 破産した抽せん回(破産しなければ totalDraws)
  win: number
  cost: number
}

export function runOneTrial(
  game: Game,
  tickets: number,
  totalDraws: number,
  opts: DoDrawOpts,
  bankroll: number,
  sampleAt: number[],
): TrialOutcome {
  const K = sampleAt.length
  const costPerRound = game.price * tickets
  const S = newSim()
  const traj: number[] = Array.from({ length: K }, () => 0)
  let s = 0
  let bal = 0
  let ruined = false
  let ruinDraw = totalDraws
  for (let i = 1; i <= totalDraws; i++) {
    doDraw(game, tickets, S, opts)
    bal = S.win - S.cost
    while (s < K && i >= sampleAt[s]) {
      traj[s] = bal
      s++
    }
    if (bankroll > 0 && bankroll + bal < costPerRound) {
      ruined = true
      ruinDraw = i
      break
    }
  }
  while (s < K) {
    traj[s] = bal
    s++
  }
  return { final: bal, traj, ruined, ruinDraw, win: S.win, cost: S.cost }
}
