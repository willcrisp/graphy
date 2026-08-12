import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import * as api from './api'
import { ApiError } from './api'
import AppDialog, { type DialogSpec } from './components/AppDialog'
import AppTabs, { OVERVIEW_TAB } from './components/AppTabs'
import ContextMenu, { type MenuItem, type MenuSpec } from './components/ContextMenu'
import DetailPanel, { type SaveState } from './components/DetailPanel'
import Graph from './components/Graph'
import ModeToggle from './components/ModeToggle'
import NodePopover from './components/NodePopover'
import ParentPanel from './components/ParentPanel'
import SignIn from './components/SignIn'
import ThemeToggle from './components/ThemeToggle'
import TitleBlock from './components/TitleBlock'
import { buildBoard, buildOverview, parentIdOf } from './canvas'
import * as optimistic from './optimistic'
import { withCounts } from './optimistic'
import { useTheme } from './theme'
import type {
  AppConfig,
  AppSummary,
  Board,
  Graph as GraphData,
  Overview,
  Status,
} from './types'
import { STATUSES, STATUS_GLYPH, STATUS_LABEL, totalOf } from './types'
import './styles/tokens.css'
import './styles/app.css'

/** The one stateful component. Owns the current page, its data, selection,
 *  and every mutation; everything under `components/` is presentational,
 *  driven by props and callbacks from here. See `runMutation` below for the
 *  optimistic-patch-then-reconcile flow every task edit goes through, and
 *  CLAUDE.md's "Every mutation is applied twice" for why. */

const EDIT_MODE_KEY = 'blueprint.editMode'

/** The two pages. A board is one app; the overview is all of them on one
 *  canvas, joined by their parent projects. They share the canvas, the tab
 *  strip and the panel, and differ in what can be edited: tasks are edited on
 *  their own board, parent projects only on the overview. */
type Page = { kind: 'overview' } | { kind: 'board'; key: string }

/** The URL carries the page so a view is linkable. History API only. */
function pageFromPath(): Page | null {
  const path = window.location.pathname
  if (/^\/all\/?$/.test(path)) return { kind: 'overview' }
  const match = path.match(/^\/a\/([A-Za-z0-9_-]+)\/?$/)
  return match ? { kind: 'board', key: match[1] } : null
}

const pathOf = (page: Page): string =>
  page.kind === 'overview' ? '/all' : `/a/${page.key}`

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [apps, setApps] = useState<AppSummary[]>([])
  const [page, setPage] = useState<Page | null>(pageFromPath())
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [signingIn, setSigningIn] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [menu, setMenu] = useState<MenuSpec | null>(null)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [theme, chooseTheme] = useTheme()

  const isOverview = page?.kind === 'overview'
  const canEdit = Boolean(config && !config.readonly && config.authenticated)
  const showEditing = canEdit && editMode
  // Tasks are edited on their own board. The overview is where the structure
  // *between* boards is edited instead -- parent projects, and which boards
  // hang off them -- so task chrome stays off there even in Edit mode.
  const editingTasks = showEditing && !isOverview
  // A view-mode click opens a node-anchored popover instead of the side
  // panel; the panel is reserved for admin (edit) mode.
  const usePopover = !showEditing

  // --- boot ---------------------------------------------------------------

  useEffect(() => {
    Promise.all([api.getConfig(), api.getApps()])
      .then(([nextConfig, nextApps]) => {
        setConfig(nextConfig)
        setApps(nextApps)
        setPage((current) => {
          const wanted = current ?? pageFromPath()
          if (wanted?.kind === 'overview') return wanted
          const found = nextApps.find((app) => app.key === wanted?.key)
          const key = (found ?? nextApps[0])?.key
          return key ? { kind: 'board', key } : null
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

  // --- navigation and URL sync --------------------------------------------

  const go = useCallback((next: Page, push = true) => {
    setPage(next)
    setSelectedId(null)
    setPanelError(null)
    setMenu(null)
    const path = pathOf(next)
    if (push && window.location.pathname !== path) {
      window.history.pushState({ path }, '', path)
    }
  }, [])

  const selectApp = useCallback(
    (key: string) => go({ kind: 'board', key }),
    [go],
  )
  const selectOverview = useCallback(() => go({ kind: 'overview' }), [go])

  useEffect(() => {
    function onPop() {
      const next = pageFromPath()
      if (next) go(next, false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [go])

  // Put the resolved page in the URL when we landed on / or an unknown key.
  useEffect(() => {
    if (page && window.location.pathname !== pathOf(page)) {
      window.history.replaceState({ path: pathOf(page) }, '', pathOf(page))
    }
  }, [page])

  // --- data loading -------------------------------------------------------

  useEffect(() => {
    if (page?.kind !== 'board') return
    const key = page.key
    let cancelled = false
    api
      .getGraph(key)
      .then((next) => !cancelled && setGraph(next))
      .catch((error: Error) => !cancelled && setBootError(error.message))
    return () => {
      cancelled = true
    }
  }, [page])

  /** Re-read the overview. Task edits happen on a board and return that board
   *  alone, so the copy held here goes stale the moment one lands -- it is
   *  re-fetched on arrival rather than patched from a board's response. */
  const loadOverview = useCallback(async () => {
    setOverview(await api.getOverview())
  }, [])

  useEffect(() => {
    if (!isOverview) return
    let cancelled = false
    api
      .getOverview()
      .then((next) => !cancelled && setOverview(next))
      .catch((error: Error) => !cancelled && setBootError(error.message))
    return () => {
      cancelled = true
    }
  }, [isOverview])

  useEffect(() => {
    document.title = isOverview
      ? 'All projects — Blueprint'
      : graph
        ? `${graph.app.name} — Blueprint`
        : 'Blueprint'
  }, [graph, isOverview])

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
    () => (page?.kind === 'board' ? apps.find((app) => app.key === page.key) ?? null : null),
    [apps, page],
  )

  /** What the canvas draws. Both pages are flattened to the same shape in
   *  `canvas.ts`, so nothing below here has to ask which page it is on. */
  const canvas = useMemo(() => {
    if (isOverview) return overview ? buildOverview(overview) : null
    return graph ? buildBoard(graph) : null
  }, [isOverview, overview, graph])

  const selected = useMemo(
    () => canvas?.nodes.find((node) => node.id === selectedId) ?? null,
    [canvas, selectedId],
  )
  const selectedParent = useMemo(() => {
    if (selected?.kind !== 'parent' || !overview) return null
    return overview.parents.find((p) => p.id === parentIdOf(selected.id)) ?? null
  }, [selected, overview])

  const byId = useMemo(
    () => new Map((canvas?.nodes ?? []).map((node) => [node.id, node])),
    [canvas],
  )
  const incoming = useMemo(
    () =>
      (canvas?.edges ?? [])
        .filter((edge) => edge.target_id === selectedId)
        .flatMap((edge) => byId.get(edge.source_id) ?? []),
    [canvas, selectedId, byId],
  )
  const outgoing = useMemo(
    () =>
      (canvas?.edges ?? [])
        .filter((edge) => edge.source_id === selectedId)
        .flatMap((edge) => byId.get(edge.target_id) ?? []),
    [canvas, selectedId, byId],
  )

  /** The boards under the selected parent project, for the panel to list. */
  const childApps = useMemo(
    () => (selectedParent ? apps.filter((app) => app.parent_id === selectedParent.id) : []),
    [apps, selectedParent],
  )

  // --- actions ------------------------------------------------------------

  /** `/api/config` is the one source of truth for `authenticated`; both
   *  sign-in and sign-out re-read it rather than assuming their own request
   *  succeeded means the session is now in the state they expect. */
  async function refreshConfig() {
    setConfig(await api.getConfig())
  }

  async function signIn(password: string) {
    await api.login(password)
    await refreshConfig()
    setSigningIn(false)
    changeMode(true)
  }

  async function signOut() {
    await api.logout()
    await refreshConfig()
    setEditMode(false)
  }

  function addNode() {
    if (page?.kind !== 'board' || !graph) return
    const key = page.key
    const fields = { title: 'New task', status: 'todo' as Status }
    const draft = optimistic.draftNode(graph, fields)

    // Select the draft straight away so the panel is ready to type into.
    setSelectedId(draft.id)
    void runMutation(
      (current) => optimistic.insertNode(current, draft),
      () => api.createNode(key, fields),
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
    if (page?.kind !== 'board') return
    const key = page.key
    setSelectedId(target)
    void runMutation(
      (current) => optimistic.insertEdge(current, source, target),
      () => api.createEdge(key, source, target),
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

  // --- app- and parent-level actions --------------------------------------
  //
  // These deliberately bypass `runMutation`. It patches one board optimistically
  // and rolls that board back on failure, which has no meaning when the mutation
  // creates or destroys boards, or re-shapes which of them join to what -- and
  // the dialog, not the panel, is where the error belongs. Each of these instead
  // awaits the server and takes the state it returns, letting the dialog surface
  // any refusal.

  function newApp() {
    setDialog({
      title: 'New app',
      label: 'Name',
      placeholder: 'Tessellate',
      confirmLabel: 'Create app',
      onSubmit: async (name) => {
        const result = await api.createApp(name)
        setApps(result.apps)
        // A new board joins the overview as a standalone cluster, so the copy
        // held here is stale even though no parent changed.
        if (isOverview) await loadOverview()
        else selectApp(result.app.key)
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
        if (page?.kind === 'board' && key === page.key) {
          setGraph((current) =>
            current ? { ...current, app: { ...current.app, name: result.app.name } } : current,
          )
        }
        if (isOverview) await loadOverview()
      },
    })
  }

  function removeApp(key: string) {
    const app = apps.find((candidate) => candidate.key === key)
    if (!app) return
    const total = totalOf(app.counts)
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
        if (isOverview) {
          await loadOverview()
        } else if (page?.kind === 'board' && key === page.key && result.apps[0]) {
          // Deleting the board being viewed leaves nothing to draw; move to the
          // first survivor. The service refuses to delete the last app, so there
          // is always one.
          selectApp(result.apps[0].key)
        }
      },
    })
  }

  function newParent() {
    setDialog({
      title: 'New parent project',
      body: 'A name and a description. Boards are attached to it afterwards.',
      label: 'Name',
      placeholder: 'Data platform',
      detailLabel: 'Description',
      detailPlaceholder: 'What these boards have in common.',
      confirmLabel: 'Create parent project',
      onSubmit: async (name, detail) => {
        const result = await api.createParent(name, detail || null)
        setOverview(result)
        setApps(result.apps)
        setSelectedId(null)
      },
    })
  }

  /** Saved from the panel, so it patches nothing optimistically: a rename
   *  re-titles a node several boards hang off, and the overview it answers
   *  with is the honest redraw. */
  function saveParent(id: number, changes: { name?: string; detail?: string | null }) {
    setPanelError(null)
    setSaveState('saving')
    api
      .updateParent(id, changes)
      .then((result) => {
        setOverview(result)
        setApps(result.apps)
        setSaveState('saved')
        window.setTimeout(() => setSaveState('idle'), 1600)
      })
      .catch((error: Error) => {
        setSaveState('idle')
        setPanelError(error.message)
      })
  }

  /** The panel confirms inline, the way `DetailPanel` does for a task, so this
   *  half is just the request. `removeParent` below is the same thing behind a
   *  dialog, for the context menu where there is no panel to confirm in. */
  function deleteParent(id: number) {
    setSelectedId(null)
    api
      .deleteParent(id)
      .then((result) => {
        setOverview(result)
        setApps(result.apps)
      })
      .catch((error: Error) => setPanelError(error.message))
  }

  function removeParent(id: number, name: string) {
    const attached = apps.filter((app) => app.parent_id === id).length
    setDialog({
      title: `Delete ${name}?`,
      body:
        attached === 0
          ? 'Nothing is attached to it. This cannot be undone.'
          : `Its ${attached} board${attached === 1 ? '' : 's'} stay, standalone — ` +
            'only the grouping goes. This cannot be undone.',
      confirmLabel: 'Delete parent project',
      danger: true,
      onSubmit: async () => {
        const result = await api.deleteParent(id)
        setOverview(result)
        setApps(result.apps)
        setSelectedId(null)
      },
    })
  }

  async function setAppParent(key: string, parentId: number | null) {
    setMenu(null)
    try {
      const result = await api.setAppParent(key, parentId)
      setOverview(result)
      setApps(result.apps)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'That did not work.')
    }
  }

  // --- context menus ------------------------------------------------------

  function nodeMenu(id: number, x: number, y: number) {
    const node = canvas?.nodes.find((candidate) => candidate.id === id)
    if (!node) return
    const groups: MenuItem[][] = [
      [{ label: 'Open details', mark: '›', onSelect: () => setSelectedId(id) }],
    ]

    if (node.kind === 'parent') {
      if (showEditing) {
        groups.push([
          {
            label: 'Delete parent project…',
            mark: '×',
            danger: true,
            onSelect: () => removeParent(parentIdOf(id), node.title),
          },
        ])
      }
    } else if (node.kind === 'root' && isOverview) {
      // The root stands for its board, so this is the natural place to open it.
      const app = apps.find((candidate) => candidate.id === node.app_id)
      if (app) {
        groups[0].push({
          label: `Open ${app.name}`,
          mark: '→',
          onSelect: () => selectApp(app.key),
        })
        if (showEditing) groups.push(parentChoices(app))
      }
    } else if (editingTasks) {
      groups.push(
        STATUSES.map((status) => ({
          label: `Mark ${STATUS_LABEL[status].toLowerCase()}`,
          mark: STATUS_GLYPH[status],
          disabled: status === node.status,
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
    setMenu({ x, y, heading: node.title, groups })
  }

  /** "Which parent project does this board hang off" as a menu group: every
   *  parent, plus the standalone option, with the current one disabled. */
  function parentChoices(app: AppSummary): MenuItem[] {
    const parents = overview?.parents ?? []
    return [
      ...parents.map((parent) => ({
        label: `Move to ${parent.name}`,
        mark: '⌂',
        disabled: app.parent_id === parent.id,
        onSelect: () => void setAppParent(app.key, parent.id),
      })),
      {
        label: 'No parent project',
        mark: '—',
        disabled: app.parent_id === null,
        onSelect: () => void setAppParent(app.key, null),
      },
      { label: 'New parent project…', mark: '+', onSelect: newParent },
    ]
  }

  function edgeMenu(id: number, x: number, y: number) {
    const edge = canvas?.edges.find((candidate) => candidate.id === id)
    if (!edge || !editingTasks) return
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
        parentChoices(app),
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
      heading: isOverview ? 'All projects' : graph?.app.name ?? 'Board',
      groups: [
        isOverview
          ? [{ label: 'New parent project…', mark: '+', onSelect: newParent }]
          : [{ label: 'Add task', mark: '+', onSelect: addNode }],
      ],
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

  if (!config || !page || !canvas) {
    return (
      <main className="boot">
        <p className="boot__mark mono">Blueprint</p>
        <p className="boot__text">Loading…</p>
      </main>
    )
  }

  const panelled = Boolean(selected) && !usePopover

  return (
    <div className={`shell${panelled ? ' shell--panelled' : ''}`}>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__wordmark">Blueprint</span>
          <span className="topbar__sub mono">Task roadmaps</span>
        </div>
        <div className="topbar__tabs">
          <AppTabs
            apps={apps}
            activeKey={isOverview ? null : activeApp?.key ?? null}
            editMode={showEditing}
            onSelect={selectApp}
            onSelectOverview={selectOverview}
            onMenu={tabMenu}
            onAdd={newApp}
          />
        </div>
        <div className="topbar__actions">
          {canEdit ? (
            <>
              {editingTasks ? (
                <button type="button" className="button button--primary" onClick={addNode}>
                  Add task
                </button>
              ) : null}
              {showEditing && isOverview ? (
                <button type="button" className="button button--primary" onClick={newParent}>
                  New parent project
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
        className={`canvas${isOverview ? ' canvas--overview' : ''}`}
        id="canvas"
        role="tabpanel"
        aria-labelledby={`tab-${isOverview ? OVERVIEW_TAB : activeApp?.key}`}
        style={{ '--accent': activeApp?.accent ?? 'var(--st-todo)' } as React.CSSProperties}
      >
        <ReactFlowProvider>
          <Graph
            key={canvas.key}
            graph={canvas}
            editMode={editingTasks}
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
          app={isOverview ? null : graph?.app ?? null}
          apps={apps}
          counts={isOverview ? null : activeApp?.counts ?? null}
          parentCount={overview?.parents.length ?? 0}
          lastUpdated={(isOverview ? overview?.last_updated : graph?.last_updated) ?? null}
        />
      </main>

      {selectedParent && panelled ? (
        <ParentPanel
          key={selectedParent.id}
          parent={selectedParent}
          apps={childApps}
          editable={showEditing}
          saveState={saveState}
          error={panelError}
          onSave={(changes) => saveParent(selectedParent.id, changes)}
          onDelete={() => deleteParent(selectedParent.id)}
          onDetach={(key) => void setAppParent(key, null)}
          onOpenApp={selectApp}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {selected && !selectedParent && panelled ? (
        <DetailPanel
          key={selected.id}
          task={selected}
          editable={editingTasks}
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

      {selected && usePopover ? (
        <NodePopover key={selected.id} task={selected} onClose={() => setSelectedId(null)} />
      ) : null}

      {menu ? <ContextMenu menu={menu} onClose={() => setMenu(null)} /> : null}

      {dialog ? <AppDialog dialog={dialog} onClose={() => setDialog(null)} /> : null}

      {signingIn ? <SignIn onSubmit={signIn} onClose={() => setSigningIn(false)} /> : null}
    </div>
  )
}
