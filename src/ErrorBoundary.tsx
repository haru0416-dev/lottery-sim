// 本番でランタイム例外が起きてもホワイトスクリーンにせず、帳票調のフォールバックを出す
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 本番でも追跡できるようコンソールには残す(外部送信はしない)
    console.error('UIエラー:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-fallback" role="alert">
          <div className="panel">
            <h1>表示エラーが発生しました</h1>
            <p>
              申し訳ありません。画面の描画中に問題が発生しました。
              <br />
              ページを再読み込みすると復帰できる場合があります。
            </p>
            <div className="error-actions">
              <button type="button" className="btn primary" onClick={() => location.reload()}>
                再読み込み
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  try {
                    localStorage.removeItem('lotterySim.settings.v1')
                    localStorage.removeItem('lotterySim.tweaks.v1')
                  } catch {
                    /* ignore */
                  }
                  location.hash = ''
                  location.reload()
                }}
              >
                設定をリセットして再読み込み
              </button>
            </div>
            <pre className="error-detail">{this.state.error.message}</pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
