import { useEffect, useState } from 'react'
import Panel from './views/Panel'
import MainApp from './views/main/MainApp'

/** One renderer bundle; each window routes on the URL hash: #/panel or #/main[/route[/scanId]]. */
function readHash(): string[] {
  return window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
}

export default function App(): React.JSX.Element {
  const [parts, setParts] = useState(readHash)
  useEffect(() => {
    const onHash = (): void => setParts(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const isPanel = parts[0] === 'panel'
  useEffect(() => {
    document.documentElement.classList.toggle('is-panel', isPanel)
  }, [isPanel])

  return isPanel ? <Panel /> : <MainApp initialRoute={parts[1]} initialScanId={parts[2]} />
}
