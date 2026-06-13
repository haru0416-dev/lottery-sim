// 宝くじシミュレーター — 共有型定義

export interface Tier {
  label: string
  /** 1本あたりの賞金額(円) */
  prize: number
  /** d 回に n 回当たる(確率 = n / d) */
  n: number
  d: number
}

/** ロト系の物理抽せん仕様 */
export interface LottoSpec {
  /** 選ぶ本数字の個数 */
  pick: number
  /** 数字の母数(1..pool) */
  pool: number
  /** ボーナス数字の個数 */
  bonus: number
  /** 想定販売口数/回(山分けの希釈計算用) */
  sales: number
  /** 本数字一致数 m・ボーナス一致数 b から等級インデックスを返す(-1 ははずれ) */
  tierOf: (m: number, b: number) => number
}

/** キャリーオーバー設定 */
export interface CarryCfg {
  /** 全国で1等不出現になる確率(販売規模からの推定) */
  pNoWin: number
  /** 繰越1回あたりの増分 */
  add: number
  /** 1等賞金の上限額 */
  cap: number
}

export interface Game {
  id: string
  name: string
  sub: string
  price: number
  /** 「枚」または「口」 */
  unitLabel: string
  drawsPerYear: number
  freq: string
  /** ジャンボ系: 10枚1セット販売 */
  pack10?: boolean
  /** ナンバーズ系: 申込タイプ別の賞金体系を持つ */
  numbers?: boolean
  carry?: CarryCfg
  lotto?: LottoSpec
  tiers: Tier[]
}

/** ナンバーズの申込タイプ別の上書き定義 */
export interface NumbersVariant {
  sub: string
  tiers: Tier[]
}

export interface DrawnNumbers {
  main: number[]
  bonus: number[]
}

export interface LogEntry {
  i: number
  tickets: number
  cost: number
  win: number
  best: string | null
  nums: DrawnNumbers | null
}

export interface HighEntry {
  i: number
  label: string
  prize: number
  count: number
}

/** 1ランのシミュレーション状態(集計オブジェクト) */
export interface SimState {
  n: number
  cost: number
  win: number
  winCount: number
  /** 間引き保存された累積収支の点列 */
  balances: number[]
  /** balances の間引き間隔(長期ランで倍増する) */
  balStride: number
  /** 現在のキャリーオーバー繰越額 */
  carry: number
  firstJackpotAt: number | null
  jackpotPrize: number
  costAtJackpot: number
  bestPrize: number
  bestLabel: string | null
  bestAt: number
  tierCounts: Record<string, number>
  tierAmounts: Record<string, number>
  log: LogEntry[]
  highs: HighEntry[]
  highsTotal: number
}

export type PickMode = 'quick' | 'fixed'
export type JumboStyle = 'bara' | 'renban'

/** doDraw に渡す抽せんオプション */
export interface DoDrawOpts {
  /** ロト系の数字の選び方 */
  mode?: PickMode
  /** 固定数字(mode === 'fixed' のとき) */
  fixed?: number[]
  /** ジャンボの買い方 */
  jumboStyle?: JumboStyle
  /** キャリーオーバーを適用するか */
  carryOn?: boolean
  /** true でグラフ/ログ/ハイライト記録を省略(統計試行用) */
  lite?: boolean
}
