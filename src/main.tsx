import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import './styles.css'

// プロトタイプ同様、StrictMode なしで描画(rAF アニメーションの二重起動を避ける)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
