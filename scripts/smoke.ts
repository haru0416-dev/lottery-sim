// エンジンのスモークテスト(純ロジックの検証) — Node の type-stripping で実行
import { LOTTERY_GAMES, NUMBERS_VARIANTS, U } from '../src/lottery-data.ts'
import { newSim, doDraw } from '../src/sim-engine.ts'
import type { Game } from '../src/types.ts'

function game(id: string): Game {
  const g = LOTTERY_GAMES.find((x) => x.id === id)
  if (!g) throw new Error('no game ' + id)
  return g
}

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL'
  if (!cond) failures++
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`)
}

// 1) 集計の整合(厳密): cost / win / winCount が内訳と一致する
{
  const g = game('loto6')
  const S = newSim()
  const N = 50000
  for (let i = 0; i < N; i++) doDraw(g, 3, S, { mode: 'quick', carryOn: true })
  const sumCounts = Object.values(S.tierCounts).reduce((a, b) => a + b, 0)
  const sumAmts = Object.values(S.tierAmounts).reduce((a, b) => a + b, 0)
  check('loto6: cost == draws*tickets*price', S.cost === N * 3 * g.price, `cost=${S.cost}`)
  check('loto6: winCount == Σ tierCounts', S.winCount === sumCounts, `${S.winCount} vs ${sumCounts}`)
  check('loto6: win == Σ tierAmounts', Math.abs(S.win - sumAmts) < 1e-6, `${S.win} vs ${sumAmts}`)
  check('loto6: n == N', S.n === N)
}

// 2) 理論還元率への収束: ナンバーズ3ストレート(低分散)で empirical RR ≈ 0.45
{
  const g = game('numbers3')
  const S = newSim()
  const N = 2000000
  for (let i = 0; i < N; i++) doDraw(g, 1, S, {})
  const rrTheory = U.returnRateOf(g)
  const rrEmp = S.win / S.cost
  const rel = Math.abs(rrEmp - rrTheory) / rrTheory
  check(
    'numbers3: empirical RR ≈ theory (±6%)',
    rel < 0.06,
    `emp=${rrEmp.toFixed(4)} theory=${rrTheory.toFixed(4)} rel=${(rel * 100).toFixed(1)}%`,
  )
}

// 3) 物理抽せんの妥当性: ロト6 5等(3一致)の出現率が理論値付近
{
  const g = game('loto6')
  const tier5 = g.tiers[4] // 5等
  const S = newSim()
  const N = 300000
  for (let i = 0; i < N; i++) doDraw(g, 1, S, { mode: 'quick' })
  const expected = (N * tier5.n) / tier5.d
  const actual = S.tierCounts[tier5.label] || 0
  const rel = Math.abs(actual - expected) / expected
  check(
    'loto6: 5等の出現数 ≈ 理論(±12%)',
    rel < 0.12,
    `actual=${actual} expected=${expected.toFixed(0)} rel=${(rel * 100).toFixed(1)}%`,
  )
}

// 4) 固定数字 × 複数口で1等がパリミュチュエル(山分け)になる: 強制的に1等を当てて検算
{
  const g = game('miniloto') // 1等 1/169911 と当てやすい・賞金1,000万
  // 固定数字を当たり数字に合わせるのは確率依存なので、ここでは「1等を引いた回の受取総額==原資1本分」を
  // 多数試行のうち1等を含む回で確認する。
  const S = newSim()
  const fixed = [1, 2, 3, 4, 5]
  const N = 4000000
  for (let i = 0; i < N; i++) doDraw(g, 10, S, { mode: 'fixed', fixed })
  const jpCount = S.tierCounts[g.tiers[0].label] || 0
  const jpAmt = S.tierAmounts[g.tiers[0].label] || 0
  // 1等が出ていれば: 受取総額 == (基準賞金) × (当せん回数)。口数倍にはならない。
  const perWin = jpCount > 0 ? jpAmt / (jpCount / 10) : 0 // jpCountは口数加算(×10)されるので回数換算
  check('miniloto fixed×10: 1等が発生', jpCount > 0, `jpCount(口)=${jpCount}`)
  if (jpCount > 0) {
    // 1回の1等受取総額 ≈ 基準賞金(口数倍でない)
    check(
      'miniloto fixed×10: 1等の総額が原資1本分(口数倍でない)',
      Math.abs(perWin - g.tiers[0].prize) < 1,
      `perWin=${perWin} base=${g.tiers[0].prize}`,
    )
  }
}

// ── 検証スイート: データ定義と計算式の正しさ ────────────────────────────────

// 5) ロト系の当せん本数を組合せ論(閉形式)で全数照合
//    d == C(pool, pick)、各等級の本数 == Σ C(pick,m)·C(bonus,b)·C(残り, pick-m-b)
function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  k = Math.min(k, n - k)
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}
for (const id of ['loto6', 'loto7', 'miniloto']) {
  const g = game(id)
  const L = g.lotto!
  check(
    `${id}: d == C(${L.pool},${L.pick})`,
    g.tiers.every((t) => t.d === comb(L.pool, L.pick)),
  )
  const acc: number[] = Array.from({ length: g.tiers.length }, () => 0)
  for (let m = 0; m <= L.pick; m++) {
    for (let b = 0; b <= L.bonus; b++) {
      const rest = L.pick - m - b
      if (rest < 0) continue
      const ways = comb(L.pick, m) * comb(L.bonus, b) * comb(L.pool - L.pick - L.bonus, rest)
      if (!ways) continue
      const ti = L.tierOf(m, b)
      if (ti >= 0) acc[ti] += ways
    }
  }
  g.tiers.forEach((t, i) => check(`${id} ${t.label}: 定義 ${t.n}本 == 組合せ論 ${acc[i]}本`, acc[i] === t.n))
}

// 6) ナンバーズの申込タイプ別還元率はすべて理論値 45% ちょうど
for (const id of ['numbers3', 'numbers4']) {
  for (const [vname, v] of Object.entries(NUMBERS_VARIANTS[id])) {
    const ev = v.tiers.reduce((s, t) => s + (t.prize * t.n) / t.d, 0)
    const rr = ev / 200
    check(`${id} ${vname}: 還元率 == 45%`, Math.abs(rr - 0.45) < 1e-9, `rr=${(rr * 100).toFixed(4)}%`)
  }
}

// 7) ジャンボのバラ/連番メカニクス(合成ゲームで当たりやすくして検証)
//    - 7等(下1けた)は10枚パックごとに正確に1本
//    - 連番: 前後賞 == 1等×2 (構造的に厳密)
//    - 1等と前後賞を同率で増幅すればバラ/連番の総当選額(期待値)は一致
{
  const base = game('jumbo')
  const boosted: Game = {
    ...base,
    tiers: base.tiers.map((t, i) => (i === 0 ? { ...t, n: 200000 } : i === 1 ? { ...t, n: 400000 } : { ...t })),
  }
  const N = 20000
  const Sb = newSim()
  for (let i = 0; i < N; i++) doDraw(boosted, 10, Sb, { jumboStyle: 'bara' })
  const Sr = newSim()
  for (let i = 0; i < N; i++) doDraw(boosted, 10, Sr, { jumboStyle: 'renban' })
  check('jumbo バラ: 7等 == パック数(確定)', (Sb.tierCounts['7等'] || 0) === N, `${Sb.tierCounts['7等']} vs ${N}`)
  check('jumbo 連番: 7等 == パック数(確定)', (Sr.tierCounts['7等'] || 0) === N)
  check(
    'jumbo 連番: 前後賞 == 1等×2',
    (Sr.tierCounts['1等前後賞'] || 0) === (Sr.tierCounts['1等'] || 0) * 2,
    `${Sr.tierCounts['1等前後賞']} vs ${Sr.tierCounts['1等']}×2`,
  )
  const rel = Math.abs(Sb.win - Sr.win) / Math.max(Sb.win, Sr.win)
  check(
    'jumbo: バラ/連番の総当選額が一致(±8%)',
    rel < 0.08,
    `bara=${Sb.win} renban=${Sr.win} rel=${(rel * 100).toFixed(1)}%`,
  )
}

// 8) キャリーオーバー: 上限不変条件(繰越は cap - 1等基準額 を超えない)
{
  const base = game('loto6')
  const always: Game = { ...base, carry: { pNoWin: 1, add: 120000000, cap: 600000000 } }
  const S = newSim()
  for (let i = 0; i < 10; i++) doDraw(always, 1, S, { mode: 'quick', carryOn: true })
  check('carry: 繰越上限 == cap - 1等基準額', S.carry === 600000000 - 200000000, `carry=${S.carry}`)
}

// 9) NISA複利: 閉形式 A·((1+r)^t − 1)/r が年次逐次計算と一致
{
  const r = 0.05,
    A = 120000,
    t = 30
  let fv = 0
  for (let y = 0; y < t; y++) fv = fv * (1 + r) + A
  const closed = (A * (Math.pow(1 + r, t) - 1)) / r
  check(
    'NISA: 複利の閉形式 == 逐次計算',
    Math.abs(fv - closed) < closed * 1e-12,
    `closed=${closed.toFixed(2)} loop=${fv.toFixed(2)}`,
  )
}

// 10) 各種の理論還元率(ドキュメント出力 + 健全域チェック)
for (const g of LOTTERY_GAMES) {
  const rr = U.returnRateOf(g)
  console.log(`[INFO] ${g.name}: EV=¥${U.evOf(g).toFixed(2)}/1${g.unitLabel}  理論還元率=${(rr * 100).toFixed(2)}%`)
  check(`${g.id}: 還元率が宝くじの現実域(40〜50%)`, rr > 0.4 && rr < 0.5, (rr * 100).toFixed(2) + '%')
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
