// 宝くじデータ — 公表されている確率・理論賞金額に基づく定義
// (キャリーオーバーなし・賞金は理論値/代表値。ジャンボは年末ジャンボ型の1ユニット2,000万枚構成)

import type { Game, NumbersVariant, Tier } from './types.ts'

export const LOTTERY_GAMES: Game[] = [
  {
    id: 'jumbo',
    name: 'ジャンボ宝くじ',
    sub: '年末ジャンボ型',
    price: 300,
    unitLabel: '枚',
    drawsPerYear: 5,
    freq: '年5回発売(年末・サマー等)',
    pack10: true,
    tiers: [
      { label: '1等', prize: 700000000, n: 1, d: 20000000 },
      { label: '1等前後賞', prize: 150000000, n: 2, d: 20000000 },
      { label: '1等組違い賞', prize: 100000, n: 199, d: 20000000 },
      { label: '2等', prize: 10000000, n: 4, d: 20000000 },
      { label: '3等', prize: 1000000, n: 100, d: 20000000 },
      { label: '4等', prize: 50000, n: 2000, d: 20000000 },
      { label: '5等', prize: 10000, n: 50000, d: 20000000 },
      { label: '6等', prize: 3000, n: 200000, d: 20000000 },
      { label: '7等', prize: 300, n: 2000000, d: 20000000 },
    ],
  },
  {
    id: 'loto7',
    name: 'ロト7',
    sub: '37個から7個選択',
    price: 300,
    unitLabel: '口',
    drawsPerYear: 52,
    freq: '毎週金曜 抽せん',
    // キャリーオーバー: 全国で1等不出現の確率(販売規模から推定)と繰越増分、1等上限額
    carry: { pNoWin: 0.42, add: 250000000, cap: 1000000000 },
    lotto: {
      pick: 7,
      pool: 37,
      bonus: 2,
      sales: 9000000, // 想定販売口数/回(山分けの希釈計算用)
      tierOf: function (m, b) {
        if (m === 7) return 0
        if (m === 6) return b > 0 ? 1 : 2
        if (m === 5) return 3
        if (m === 4) return 4
        if (m === 3 && b > 0) return 5
        return -1
      },
    },
    tiers: [
      { label: '1等', prize: 600000000, n: 1, d: 10295472 },
      { label: '2等', prize: 7300000, n: 14, d: 10295472 },
      { label: '3等', prize: 730000, n: 196, d: 10295472 },
      { label: '4等', prize: 9100, n: 9135, d: 10295472 },
      { label: '5等', prize: 1400, n: 142100, d: 10295472 },
      { label: '6等', prize: 1000, n: 242550, d: 10295472 },
    ],
  },
  {
    id: 'loto6',
    name: 'ロト6',
    sub: '43個から6個選択',
    price: 200,
    unitLabel: '口',
    drawsPerYear: 104,
    freq: '毎週月・木曜 抽せん',
    carry: { pNoWin: 0.2, add: 120000000, cap: 600000000 },
    lotto: {
      pick: 6,
      pool: 43,
      bonus: 1,
      sales: 10000000,
      tierOf: function (m, b) {
        if (m === 6) return 0
        if (m === 5) return b > 0 ? 1 : 2
        if (m === 4) return 3
        if (m === 3) return 4
        return -1
      },
    },
    tiers: [
      { label: '1等', prize: 200000000, n: 1, d: 6096454 },
      { label: '2等', prize: 10000000, n: 6, d: 6096454 },
      { label: '3等', prize: 300000, n: 216, d: 6096454 },
      { label: '4等', prize: 6800, n: 9990, d: 6096454 },
      { label: '5等', prize: 1000, n: 155400, d: 6096454 },
    ],
  },
  {
    id: 'miniloto',
    name: 'ミニロト',
    sub: '31個から5個選択',
    price: 200,
    unitLabel: '口',
    drawsPerYear: 52,
    freq: '毎週火曜 抽せん',
    lotto: {
      pick: 5,
      pool: 31,
      bonus: 1,
      sales: 2000000,
      tierOf: function (m, b) {
        if (m === 5) return 0
        if (m === 4) return b > 0 ? 1 : 2
        if (m === 3) return 3
        return -1
      },
    },
    tiers: [
      { label: '1等', prize: 10000000, n: 1, d: 169911 },
      { label: '2等', prize: 150000, n: 5, d: 169911 },
      { label: '3等', prize: 10000, n: 125, d: 169911 },
      // 4等(3個一致) = C(5,3)×C(26,2) = 3,250本(公式の約1/52と一致)。
      // プロトタイプは3,000本としていたが組合せ論で誤りと確定し修正済み。
      { label: '4等', prize: 1000, n: 3250, d: 169911 },
    ],
  },
  {
    id: 'numbers3',
    name: 'ナンバーズ3',
    sub: 'ストレート',
    numbers: true,
    price: 200,
    unitLabel: '口',
    drawsPerYear: 250,
    freq: '平日 毎日抽せん',
    tiers: [{ label: 'ストレート', prize: 90000, n: 1, d: 1000 }],
  },
  {
    id: 'numbers4',
    name: 'ナンバーズ4',
    sub: 'ストレート',
    numbers: true,
    price: 200,
    unitLabel: '口',
    drawsPerYear: 250,
    freq: '平日 毎日抽せん',
    tiers: [{ label: 'ストレート', prize: 900000, n: 1, d: 10000 }],
  },
  {
    id: 'scratch',
    name: 'スクラッチ',
    sub: '1等100万円型',
    price: 200,
    unitLabel: '枚',
    drawsPerYear: 52,
    freq: '週1回購入と仮定',
    tiers: [
      { label: '1等', prize: 1000000, n: 2, d: 1000000 },
      { label: '2等', prize: 100000, n: 20, d: 1000000 },
      { label: '3等', prize: 10000, n: 1000, d: 1000000 },
      { label: '4等', prize: 1000, n: 40000, d: 1000000 },
      { label: '5等', prize: 200, n: 166667, d: 1000000 },
    ],
  },
]

// ナンバーズの申込タイプ別の理論賞金(ボックス・セットは全桁が異なる数字を選んだ場合)
export const NUMBERS_VARIANTS: Record<string, Record<string, NumbersVariant>> = {
  numbers3: {
    ストレート: { sub: 'ストレート', tiers: [{ label: 'ストレート', prize: 90000, n: 1, d: 1000 }] },
    ボックス: { sub: 'ボックス', tiers: [{ label: 'ボックス', prize: 15000, n: 6, d: 1000 }] },
    セット: {
      sub: 'セット(各半口)',
      tiers: [
        { label: 'セット(ST)', prize: 52500, n: 1, d: 1000 },
        { label: 'セット(BOX)', prize: 7500, n: 5, d: 1000 },
      ],
    },
  },
  numbers4: {
    ストレート: { sub: 'ストレート', tiers: [{ label: 'ストレート', prize: 900000, n: 1, d: 10000 }] },
    ボックス: { sub: 'ボックス', tiers: [{ label: 'ボックス', prize: 37500, n: 24, d: 10000 }] },
    セット: {
      sub: 'セット(各半口)',
      tiers: [
        { label: 'セット(ST)', prize: 468750, n: 1, d: 10000 },
        { label: 'セット(BOX)', prize: 18750, n: 23, d: 10000 },
      ],
    },
  },
}

// ── フォーマット/集計ユーティリティ ──────────────────────────────────────────

/** 期待値(1口あたりの賞金期待額) */
function evOf(game: Game): number {
  return game.tiers.reduce((s, t) => s + (t.prize * t.n) / t.d, 0)
}

/** 理論還元率 */
function returnRateOf(game: Game): number {
  return evOf(game) / game.price
}

function fmtYen(v: number): string {
  const sign = v < 0 ? '-' : ''
  return sign + '¥' + Math.round(Math.abs(v)).toLocaleString('ja-JP')
}

function fmtYenSigned(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '±'
  return sign + '¥' + Math.round(Math.abs(v)).toLocaleString('ja-JP')
}

function fmtYenShort(v: number): string {
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  function trim(x: number): string {
    let r: string
    if (x >= 100) r = Math.round(x).toLocaleString('ja-JP')
    else if (x >= 10) r = (Math.round(x * 10) / 10).toString()
    else r = (Math.round(x * 100) / 100).toString()
    return r.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')
  }
  if (a >= 100000000) return s + trim(a / 100000000) + '億円'
  if (a >= 10000) return s + trim(a / 10000) + '万円'
  return s + Math.round(a).toLocaleString('ja-JP') + '円'
}

/** 1,000万円以上は短縮表記、それ未満は全桁表記 */
function fmtYenAuto(v: number): string {
  return Math.abs(v) >= 10000000 ? fmtYenShort(v) : fmtYen(v)
}

function fmtYenSignedAuto(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '±'
  const a = Math.abs(v)
  if (a >= 10000000) return sign + fmtYenShort(a)
  return sign + '¥' + Math.round(a).toLocaleString('ja-JP')
}

function fmtProb(tier: Tier): string {
  return '1/' + Math.round(tier.d / tier.n).toLocaleString('ja-JP')
}

export const U = {
  evOf,
  returnRateOf,
  fmtYen,
  fmtYenSigned,
  fmtYenShort,
  fmtYenAuto,
  fmtYenSignedAuto,
  fmtProb,
}

// 種別ID + 申込タイプ から実際に使うゲーム定義を得る(ナンバーズはタイプで賞金体系が変わる)。
// App と Worker で同じ結果になるよう一元化。
export function effGameOf(gameId: string, betType: string): Game {
  const g = LOTTERY_GAMES.find((x) => x.id === gameId)
  if (!g) throw new Error('unknown game: ' + gameId)
  if (g.numbers && NUMBERS_VARIANTS[gameId]) {
    const v = NUMBERS_VARIANTS[gameId][betType] || NUMBERS_VARIANTS[gameId]['ストレート']
    return Object.assign({}, g, { sub: v.sub, tiers: v.tiers })
  }
  return g
}
