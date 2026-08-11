import { useEffect, useState } from 'react'
import { getHealth } from './api'

type Probe =
  | { state: 'loading' }
  | { state: 'ok'; status: string }
  | { state: 'error'; message: string }

export default function App() {
  const [probe, setProbe] = useState<Probe>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    getHealth()
      .then((health) => !cancelled && setProbe({ state: 'ok', status: health.status }))
      .catch((error: Error) => !cancelled && setProbe({ state: 'error', message: error.message }))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', padding: '3rem' }}>
      <h1>Blueprint</h1>
      <p>
        backend:{' '}
        {probe.state === 'loading'
          ? 'checking…'
          : probe.state === 'ok'
            ? probe.status
            : `unreachable — ${probe.message}`}
      </p>
    </main>
  )
}
