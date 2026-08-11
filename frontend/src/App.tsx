import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import * as api from './api'
import { ApiError } from './api'
import AppTabs from './components/AppTabs'
import DetailPanel, { type SaveState } from './components/DetailPanel'
import Graph from './components/Graph'
import ModeToggle from './components/ModeToggle'
import SignIn from './components/SignIn'
import TitleBlock from './components/TitleBlock'
import type { AppConfig, AppSummary, Graph as GraphData, Status } from './types'
import './styles/tokens.css'
import './styles/app.css'

const EDIT_MODE_KEY = 'blueprint.editMode'

/** The URL carries the app key so a view is linkable. History API only. */
function keyFromPath(): string | null {
  const match = window.location.pathname.match(/^\/a\/([A-Za-z0-9_-]+)\/?$/)
  return match ? match[1] : null
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [apps, setApps] = useState<AppSummary[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(keyFromPath())
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [signingIn, setSigningIn] = useState(false)
  const [editMode, setEditMode] = useState(false)

  const canEdit = Boolean(config && !config.readonly && config.authenticated)
  const showEditing = canEdit && editMode

  // --- boot ---------------------------------------------------------------

  useEffect(() => {
    Promise.all([api.getConfig(), api.getApps()])
      .then(([nextConfig, nextApps]) => {
        setConfig(nextConfig)
        setApps(nextApps)
        setActiveKey((current) => {
          const wanted = current ?? keyFromPath()
          const found = nextApps.find((app) => app.key === wanted)
          return (found ?? nextApps[0])?.key ?? null
        })
      })
      .catch((error: Error) => setBootError(error.message))
  }, [])

  // Edit mode defaults to View and is only honoured once we know the session
  // actually permits editing.
  useEffect(() => {
    if (!canEdit) {
      setEditMode(false)
      return
    }
    setEditMode(window.localStorage.getItem(EDIT_MODE_KEY) === 'edit')
  }, [canEdit])

  const changeMode = useCallback((next: boolean) => {
    setEditMode(next)
    window.localStorage.setItem(EDIT_MODE_KEY, next ? 'edit' : 'view')
  }, [])

  // --- app selection and URL sync -----------------------------------------

  const selectApp = useCallback(
    (key: string, push = true) => {
      setActiveKey(key)
      setSelectedId(null)
      setPanelError(null)
      if (push && keyFromPath() !== key) {
        window.history.pushState({ key }, '', `/a/${key}`)
      }
    },
    [],
  )

  useEffect(() => {
    function onPop() {
      const key = keyFromPath()
      if (key) selectApp(key, false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [selectApp])

  // Put the resolved key in the URL when we landed on / or an unknown key.
  useEffect(() => {
    if (activeKey && keyFromPath() !== activeKey) {
      window.history.replaceState({ key: activeKey }, '', `/a/${activeKey}`)
    }
  }, [activeKey])

  // --- graph loading ------------------------------------------------------

  const loadGraph = useCallback(async (key: string) => {
    const next = await api.getGraph(key)
    setGraph(next)
    return next
  }, [])

  useEffect(() => {
    if (!activeKey) return
    let cancelled = false
    api
      .getGraph(activeKey)
      .then((next) => !cancelled && setGraph(next))
      .catch((error: Error) => !cancelled && setBootError(error.message))
    return () => {
      cancelled = true
    }
  }, [activeKey])

  useEffect(() => {
    document.title = graph ? `${graph.app.name} — Blueprint` : 'Blueprint'
  }, [graph])

  /** Every mutation refetches. At tens of nodes this is imperceptible and far
   *  simpler than patching state optimistically. */
  const refresh = useCallback(async () => {
    if (!activeKey) return
    const [nextGraph, nextApps] = await Promise.all([loadGraph(activeKey), api.getApps()])
    setApps(nextApps)
    return nextGraph
  }, [activeKey, loadGraph])

  const runMutation = useCallback(
    async (action: () => Promise<unknown>, options?: { keepSelection?: boolean }) => {
      setPanelError(null)
      setSaveState('saving')
      try {
        await action()
        await refresh()
        setSaveState('saved')
        window.setTimeout(() => setSaveState('idle'), 1600)
        if (!options?.keepSelection) setSelectedId((current) => current)
        return true
      } catch (error) {
        setSaveState('idle')
        setPanelError(
          error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
        )
        if (error instanceof ApiError && error.status === 401) {
          setConfig((current) => (current ? { ...current, authenticated: false } : current))
        }
        return false
      }
    },
    [refresh],
  )

  // --- derived ------------------------------------------------------------

  const activeApp = useMemo(
    () => apps.find((app) => app.key === activeKey) ?? null,
    [apps, activeKey],
  )
  const selected = useMemo(
    () => graph?.nodes.find((node) => node.id === selectedId) ?? null,
    [graph, selectedId],
  )
  const byId = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph],
  )
  const incoming = useMemo(
    () =>
      (graph?.edges ?? [])
        .filter((edge) => edge.target_id === selectedId)
        .flatMap((edge) => byId.get(edge.source_id) ?? []),
    [graph, selectedId, byId],
  )
  const outgoing = useMemo(
    () =>
      (graph?.edges ?? [])
        .filter((edge) => edge.source_id === selectedId)
        .flatMap((edge) => byId.get(edge.target_id) ?? []),
    [graph, selectedId, byId],
  )

  // --- actions ------------------------------------------------------------

  async function signIn(password: string) {
    await api.login(password)
    setConfig(await api.getConfig())
    setSigningIn(false)
    changeMode(true)
  }

  async function signOut() {
    await api.logout()
    setConfig(await api.getConfig())
    setEditMode(false)
  }

  async function addNode() {
    if (!activeKey) return
    setPanelError(null)
    try {
      const created = await api.createNode(activeKey, {
        title: 'New feature',
        status: 'todo',
      })
      await refresh()
      setSelectedId(created.id)
    } catch (error) {
      setPanelError(error instanceof ApiError ? error.message : 'Could not add the feature.')
    }
  }

  function saveSelected(changes: {
    title?: string
    detail?: string | null
    status?: Status
  }) {
    if (!selected) return
    void runMutation(() => api.updateNode(selected.id, changes), { keepSelection: true })
  }

  async function removeSelected() {
    if (!selected) return
    const ok = await runMutation(() => api.deleteNode(selected.id))
    if (ok) setSelectedId(null)
  }

  function connect(source: number, target: number) {
    if (!activeKey) return
    setSelectedId(target)
    void runMutation(() => api.createEdge(activeKey, source, target), {
      keepSelection: true,
    })
  }

  function disconnect(otherId: number, direction: 'in' | 'out') {
    if (!graph || selectedId === null) return
    const edge = graph.edges.find((candidate) =>
      direction === 'in'
        ? candidate.source_id === otherId && candidate.target_id === selectedId
        : candidate.source_id === selectedId && candidate.target_id === otherId,
    )
    if (!edge) return
    void runMutation(() => api.deleteEdge(edge.id), { keepSelection: true })
  }

  // --- render -------------------------------------------------------------

  if (bootError) {
    return (
      <main className="boot">
        <p className="boot__mark mono">Blueprint</p>
        <p className="boot__text">{bootError}</p>
      </main>
    )
  }

  if (!config || !activeApp || !graph) {
    return (
      <main className="boot">
        <p className="boot__mark mono">Blueprint</p>
        <p className="boot__text">Loading…</p>
      </main>
    )
  }

  return (
    <div className={`shell${selected ? ' shell--panelled' : ''}`}>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__wordmark">Blueprint</span>
          <span className="topbar__sub mono">Feature roadmaps</span>
        </div>
        <div className="topbar__tabs">
          <AppTabs apps={apps} activeKey={activeApp.key} onSelect={selectApp} />
        </div>
        <div className="topbar__actions">
          {canEdit ? (
            <>
              {showEditing ? (
                <button type="button" className="button button--primary" onClick={addNode}>
                  Add feature
                </button>
              ) : null}
              <ModeToggle editMode={editMode} onChange={changeMode} />
              <button type="button" className="button button--quiet mono" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : config.readonly ? null : (
            <button
              type="button"
              className="button button--quiet mono"
              onClick={() => setSigningIn(true)}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <main
        className="canvas"
        id="canvas"
        role="tabpanel"
        aria-labelledby={`tab-${activeApp.key}`}
        style={{ '--accent': activeApp.accent } as React.CSSProperties}
      >
        <ReactFlowProvider>
          <Graph
            key={activeApp.key}
            graph={graph}
            editMode={showEditing}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onConnect={connect}
            onAddFirst={addNode}
          />
        </ReactFlowProvider>
        <TitleBlock
          app={graph.app}
          counts={activeApp.counts}
          lastUpdated={graph.last_updated}
        />
      </main>

      {selected ? (
        <DetailPanel
          key={selected.id}
          feature={selected}
          editable={showEditing}
          saveState={saveState}
          error={panelError}
          incoming={incoming}
          outgoing={outgoing}
          onSave={saveSelected}
          onDelete={removeSelected}
          onDisconnect={disconnect}
          onClose={() => setSelectedId(null)}
          onSelectFeature={setSelectedId}
        />
      ) : null}

      {signingIn ? <SignIn onSubmit={signIn} onClose={() => setSigningIn(false)} /> : null}
    </div>
  )
}
