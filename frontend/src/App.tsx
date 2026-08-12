import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import * as api from './api'
import { ApiError } from './api'
import AppDialog, { type DialogSpec } from './components/AppDialog'
import AppTabs from './components/AppTabs'
import ContextMenu, { type MenuItem, type MenuSpec } from './components/ContextMenu'
import DetailPanel, { type SaveState } from './components/DetailPanel'
import Graph from './components/Graph'
import ModeToggle from './components/ModeToggle'
import SignIn from './components/SignIn'
import ThemeToggle from './components/ThemeToggle'
import TitleBlock from './components/TitleBlock'
import * as optimistic from './optimistic'
import { withCounts } from './optimistic'
import { useTheme } from './theme'
import type { AppConfig, AppSummary, Board, Graph as GraphData, Status } from './types'
import { STATUSES, STATUS_GLYPH, STATUS_LABEL } from './types'
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
  const [menu, setMenu] = useState<MenuSpec | null>(null)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [theme, chooseTheme] = useTheme()

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
    setMenu(null)
    window.localStorage.setItem(EDIT_MODE_KEY, next ? 'edit' : 'view')
  }, [])

  // --- app selection and URL sync -----------------------------------------

  const selectApp = useCallback(
    (key: string, push = true) => {
      setActiveKey(key)
      setSelectedId(null)
      setPanelError(null)
      setMenu(null)
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

  /** Counts the mutations that have been started, so a reconcile or a rollback
   *  can tell whether it is still the newest one. */
  const mutationSeq = useRef(0)

  /** Mutations are applied locally first and the board redraws on the click.
   *  The request that follows is the authority: its response replaces the graph
   *  outright, and a failure puts the previous one back.
   *
   *  The rollback matters more here than in most optimistic UIs. Rejecting a
   *  cycle or a duplicate connection is a normal, expected outcome in this app,
   *  not an edge case -- those edges have to disappear again, with the server's
   *  sentence explaining why.
   *
   *  `patch` must be pure -- it is called with the current graph and must not
   *  reach back out to set state. Callers that need the temp id of a row they
   *  are about to insert build it first (see `optimistic.draftNode`). */
  const runMutation = useCallback(
    async <T extends Board>(
      patch: (current: GraphData) => GraphData,
      action: () => Promise<T>,
      /** Runs in the same batch as the reconcile, so selection can follow a
       *  temp id to its real one without a frame where neither exists. */
      onReconciled?: (result: T) => void,
    ): Promise<T | null> => {
      if (!graph) return null
      const previousGraph = graph
      const previousApps = apps
      const seq = (mutationSeq.current += 1)

      const optimistic = patch(graph)
      setGraph(optimistic)
      setApps(withCounts(apps, optimistic))
      setPanelError(null)
      setSaveState('saving')

      try {
        const result = await action()
        // Always applied, even if a newer mutation is in flight: the server
        // serialises writes, so its answer is never staler than our guess.
        setGraph(result.graph)
        setApps(result.apps)
        onReconciled?.(result)
        setSaveState('saved')
        window.setTimeout(() => setSaveState('idle'), 1600)
        return result
      } catch (error) {
        // Only the newest mutation may roll back. An older one restoring its
        // snapshot would undo a newer optimistic patch that is still pending;
        // leaving it alone lets that newer mutation's reconcile settle it.
        if (seq === mutationSeq.current) {
          setGraph(previousGraph)
          setApps(previousApps)
        }
        setSaveState('idle')
        setPanelError(
          error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
        )
        if (error instanceof ApiError && error.status === 401) {
          setConfig((current) => (current ? { ...current, authenticated: false } : current))
        }
        return null
      }
    },
    [graph, apps],
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

  function addNode() {
    if (!activeKey || !graph) return
    const fields = { title: 'New task', status: 'todo' as Status }
    const draft = optimistic.draftNode(graph, fields)

    // Select the draft straight away so the panel is ready to type into.
    setSelectedId(draft.id)
    void runMutation(
      (current) => optimistic.insertNode(current, draft),
      () => api.createNode(activeKey, fields),
      // The temp row is gone by the time this runs; move the selection onto the
      // real one in the same batch, or the panel blanks for a frame.
      (result) => setSelectedId(result.node.id),
    )
  }

  function saveSelected(changes: {
    title?: string
    detail?: string | null
    status?: Status
  }) {
    if (!selected) return
    const id = selected.id
    void runMutation(
      (current) => optimistic.patchNode(current, id, changes),
      () => api.updateNode(id, changes),
    )
  }

  function removeSelected() {
    if (!selected) return
    const id = selected.id
    setSelectedId(null)
    void runMutation(
      (current) => optimistic.removeNode(current, id),
      () => api.deleteNode(id),
    )
  }

  function connect(source: number, target: number) {
    if (!activeKey) return
    setSelectedId(target)
    void runMutation(
      (current) => optimistic.insertEdge(current, source, target),
      () => api.createEdge(activeKey, source, target),
    )
  }

  function disconnect(otherId: number, direction: 'in' | 'out') {
    if (!graph || selectedId === null) return
    const edge = graph.edges.find((candidate) =>
      direction === 'in'
        ? candidate.source_id === otherId && candidate.target_id === selectedId
        : candidate.source_id === selectedId && candidate.target_id === otherId,
    )
    if (!edge) return
    const id = edge.id
    void runMutation(
      (current) => optimistic.removeEdge(current, id),
      () => api.deleteEdge(id),
    )
  }

  // --- app-level actions --------------------------------------------------
  //
  // These deliberately bypass `runMutation`. It patches one board optimistically
  // and rolls that board back on failure, which has no meaning when the mutation
  // creates or destroys boards -- and the dialog, not the panel, is where the
  // error belongs. Each of these instead awaits the server and takes the tab
  // strip it returns, letting the dialog surface any refusal.

  function newApp() {
    setDialog({
      title: 'New app',
      label: 'Name',
      placeholder: 'Tessellate',
      confirmLabel: 'Create app',
      onSubmit: async (name) => {
        const result = await api.createApp(name)
        setApps(result.apps)
        selectApp(result.app.key)
      },
    })
  }

  function renameApp(key: string) {
    const app = apps.find((candidate) => candidate.key === key)
    if (!app) return
    setDialog({
      title: 'Rename app',
      body: 'The name changes everywhere. Links to this board keep working.',
      label: 'Name',
      initial: app.name,
      confirmLabel: 'Rename',
      onSubmit: async (name) => {
        const result = await api.renameApp(key, name)
        setApps(result.apps)
        // The graph carries its own copy of the app, so the title block and the
        // document title need the new name too.
        if (key === activeKey) {
          setGraph((current) =>
            current ? { ...current, app: { ...current.app, name: result.app.name } } : current,
          )
        }
      },
    })
  }

  function removeApp(key: string) {
    const app = apps.find((candidate) => candidate.key === key)
    if (!app) return
    const total =
      app.counts.done + app.counts.wip + app.counts.todo + app.counts.blocked
    setDialog({
      title: `Delete ${app.name}?`,
      body:
        total === 0
          ? 'It has no tasks. This cannot be undone.'
          : `Its ${total} task${total === 1 ? '' : 's'} and every connection ` +
            'between them go with it. This cannot be undone.',
      confirmLabel: 'Delete app',
      danger: true,
      onSubmit: async () => {
        const result = await api.deleteApp(key)
        setApps(result.apps)
        // Deleting the board being viewed leaves nothing to draw; move to the
        // first survivor. The service refuses to delete the last app, so there
        // is always one.
        if (key === activeKey && result.apps[0]) selectApp(result.apps[0].key)
      },
    })
  }

  // --- context menus ------------------------------------------------------

  function nodeMenu(id: number, x: number, y: number) {
    const task = graph?.nodes.find((node) => node.id === id)
    if (!task) return
    const groups: MenuItem[][] = [
      [{ label: 'Open details', mark: '›', onSelect: () => setSelectedId(id) }],
    ]
    if (showEditing) {
      groups.push(
        STATUSES.map((status) => ({
          label: `Mark ${STATUS_LABEL[status].toLowerCase()}`,
          mark: STATUS_GLYPH[status],
          disabled: status === task.status,
          onSelect: () =>
            void runMutation(
              (current) => optimistic.patchNode(current, id, { status }),
              () => api.updateNode(id, { status }),
            ),
        })),
        [
          {
            label: 'Delete task',
            mark: '×',
            danger: true,
            onSelect: () => {
              if (selectedId === id) setSelectedId(null)
              void runMutation(
                (current) => optimistic.removeNode(current, id),
                () => api.deleteNode(id),
              )
            },
          },
        ],
      )
    }
    setMenu({ x, y, heading: task.title, groups })
  }

  function edgeMenu(id: number, x: number, y: number) {
    const edge = graph?.edges.find((candidate) => candidate.id === id)
    if (!edge || !showEditing) return
    const source = byId.get(edge.source_id)
    const target = byId.get(edge.target_id)
    if (!source || !target) return
    setMenu({
      x,
      y,
      heading: `${source.title} → ${target.title}`,
      groups: [
        [
          {
            label: 'Remove dependency',
            mark: '×',
            danger: true,
            onSelect: () =>
              void runMutation(
                (current) => optimistic.removeEdge(current, id),
                () => api.deleteEdge(id),
              ),
          },
        ],
      ],
    })
  }

  function tabMenu(key: string, x: number, y: number) {
    const app = apps.find((candidate) => candidate.key === key)
    if (!app) return
    const groups: MenuItem[][] = [
      [{ label: 'Open board', mark: '›', onSelect: () => selectApp(key) }],
    ]
    if (showEditing) {
      groups.push(
        [
          { label: 'Rename app…', mark: '✎', onSelect: () => renameApp(key) },
          { label: 'New app…', mark: '+', onSelect: newApp },
        ],
        [
          {
            label: 'Delete app…',
            mark: '×',
            danger: true,
            // The last app cannot go; say so here rather than only on refusal.
            disabled: apps.length <= 1,
            onSelect: () => removeApp(key),
          },
        ],
      )
    }
    setMenu({ x, y, heading: app.name, groups })
  }

  function paneMenu(x: number, y: number) {
    if (!showEditing) return
    setMenu({
      x,
      y,
      heading: graph?.app.name ?? 'Board',
      groups: [[{ label: 'Add task', mark: '+', onSelect: addNode }]],
    })
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
          <span className="topbar__sub mono">Task roadmaps</span>
        </div>
        <div className="topbar__tabs">
          <AppTabs
            apps={apps}
            activeKey={activeApp.key}
            editMode={showEditing}
            onSelect={selectApp}
            onMenu={tabMenu}
            onAdd={newApp}
          />
        </div>
        <div className="topbar__actions">
          {canEdit ? (
            <>
              {showEditing ? (
                <button type="button" className="button button--primary" onClick={addNode}>
                  Add task
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
          <ThemeToggle theme={theme} onChange={chooseTheme} />
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
            onNodeMenu={nodeMenu}
            onEdgeMenu={edgeMenu}
            onPaneMenu={paneMenu}
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
          task={selected}
          editable={showEditing}
          saveState={saveState}
          error={panelError}
          incoming={incoming}
          outgoing={outgoing}
          onSave={saveSelected}
          onDelete={removeSelected}
          onDisconnect={disconnect}
          onClose={() => setSelectedId(null)}
          onSelectTask={setSelectedId}
        />
      ) : null}

      {menu ? <ContextMenu menu={menu} onClose={() => setMenu(null)} /> : null}

      {dialog ? <AppDialog dialog={dialog} onClose={() => setDialog(null)} /> : null}

      {signingIn ? <SignIn onSubmit={signIn} onClose={() => setSigningIn(false)} /> : null}
    </div>
  )
}
