import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { StickyNote, Quote, Image as ImageIcon, Hammer, Trash2, Sparkles, Feather, Sunrise, Compass, Hourglass } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/auth'
import { canvas as canvasApi } from '@/lib/api'
import type { CanvasNode, CanvasNodeType, StickyColor } from '@/types'
import { StickyNode, type StickyData } from '@/components/canvas/StickyNode'
import { ReflectionChat, type ExerciseKey } from '@/components/canvas/ReflectionChat'
import { SynthesisPanel } from '@/components/canvas/SynthesisPanel'
import { compressImageFile, imageUrlFromDataTransfer } from '@/lib/image'

const REFLECT_EXERCISES: { key: ExerciseKey; label: string; icon: typeof Feather; color: StickyColor }[] = [
  { key: 'eulogy', label: 'The Eulogy', icon: Feather, color: 'pink' },
  { key: 'perfect_day', label: 'Perfect Day', icon: Sunrise, color: 'green' },
  { key: 'values', label: 'Core Values', icon: Compass, color: 'yellow' },
  { key: 'future_self', label: '90-Year-Old You', icon: Hourglass, color: 'blue' },
]

const nodeTypes: NodeTypes = { sticky: StickyNode as unknown as NodeTypes[string] }

const NEW_NODE: Record<CanvasNodeType, { color: StickyColor }> = {
  note: { color: 'yellow' },
  quote: { color: 'green' },
  text: { color: 'plain' },
  image: { color: 'plain' },
}

function CanvasInner() {
  const wsId = useAuthStore((s) => s.activeWorkstationId)!
  const qc = useQueryClient()
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [reflectExercise, setReflectExercise] = useState<ExerciseKey | null>(null)
  const [synthNotes, setSynthNotes] = useState<string[] | null>(null)

  const { data } = useQuery({
    queryKey: ['canvas', wsId],
    queryFn: () => canvasApi.list(wsId),
    enabled: !!wsId,
    staleTime: 0, // always refetch on mount so a stale persisted cache can't blank the board
  })

  // Keep the React Query cache (the canonical store) in sync after a mutation.
  const patchCache = useCallback(
    (fn: (nodes: CanvasNode[]) => CanvasNode[]) => {
      qc.setQueryData<{ nodes: CanvasNode[] }>(['canvas', wsId], (old) =>
        old ? { nodes: fn(old.nodes) } : old
      )
    },
    [qc, wsId]
  )

  const onContentChange = useCallback(
    (id: string, content: string) => {
      patchCache((nds) => nds.map((n) => (n.id === id ? { ...n, content } : n)))
      canvasApi.update(wsId, id, { content }).catch(() => toast.error('Could not save'))
    },
    [wsId, patchCache]
  )

  const toRfNode = useCallback(
    (n: CanvasNode): Node => ({
      id: n.id,
      type: 'sticky',
      position: { x: n.x, y: n.y },
      selected: n.id === selectedId,
      data: {
        type: n.type,
        content: n.content,
        imageUrl: n.imageUrl,
        color: n.color,
        width: n.width,
        onChange: onContentChange,
      } satisfies StickyData,
    }),
    [onContentChange, selectedId]
  )

  // The server query is the source of truth — rebuild RF nodes whenever it
  // changes. Live drag/typing is handled locally (onNodesChange / textarea
  // state) and only writes to the cache on drop/blur, so this never interrupts.
  useEffect(() => {
    if (!data) return
    setNodes(data.nodes.map(toRfNode))
  }, [data, toRfNode, setNodes])

  const addNode = useCallback(
    async (type: CanvasNodeType) => {
      let imageUrl: string | null = null
      if (type === 'image') {
        imageUrl = window.prompt('Image URL') || null
        if (!imageUrl) return
      }
      const rect = wrapRef.current?.getBoundingClientRect()
      const pos = screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
      })
      // jitter so stacked adds don't perfectly overlap
      pos.x += (Math.random() - 0.5) * 60
      pos.y += (Math.random() - 0.5) * 60
      try {
        const { node } = await canvasApi.create(wsId, {
          type,
          content: '',
          imageUrl,
          x: pos.x,
          y: pos.y,
          color: NEW_NODE[type].color,
        })
        patchCache((nds) => [...nds, node])
      } catch {
        toast.error('Could not add')
      }
    },
    [wsId, screenToFlowPosition, patchCache]
  )

  // Drop a note onto the board near the viewport centre (jittered so stacked
  // adds don't perfectly overlap).
  const createNote = useCallback(
    async (content: string, color: StickyColor) => {
      const rect = wrapRef.current?.getBoundingClientRect()
      const pos = screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
      })
      pos.x += (Math.random() - 0.5) * 140
      pos.y += (Math.random() - 0.5) * 140
      try {
        const { node } = await canvasApi.create(wsId, { type: 'note', content, imageUrl: null, x: pos.x, y: pos.y, color })
        patchCache((nds) => [...nds, node])
        toast.success('Added to canvas')
      } catch {
        toast.error('Could not add to canvas')
      }
    },
    [wsId, screenToFlowPosition, patchCache]
  )

  // Reflection insights are themed by the exercise's colour.
  const addReflectionNote = useCallback(
    (content: string) =>
      createNote(content, REFLECT_EXERCISES.find((e) => e.key === reflectExercise)?.color ?? 'blue'),
    [createNote, reflectExercise]
  )

  // Gather every note/quote's text — the raw material for synthesis.
  const collectNotes = useCallback((): string[] => {
    const cache = qc.getQueryData<{ nodes: CanvasNode[] }>(['canvas', wsId])
    return (cache?.nodes ?? [])
      .filter((n) => n.type !== 'image' && n.content.trim())
      .map((n) => n.content.trim())
  }, [qc, wsId])

  const sendToArchitect = useCallback(
    (prefill: { title?: string; whyText?: string }) => navigate('/app/architect', { state: { prefill } }),
    [navigate]
  )

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      patchCache((nds) =>
        nds.map((n) => (n.id === node.id ? { ...n, x: node.position.x, y: node.position.y } : n))
      )
      canvasApi.update(wsId, node.id, { x: node.position.x, y: node.position.y }).catch(() => {})
    },
    [wsId, patchCache]
  )

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    canvasApi.remove(wsId, selectedId).catch(() => {})
    patchCache((nds) => nds.filter((n) => n.id !== selectedId))
    setSelectedId(null)
  }, [selectedId, wsId, patchCache])

  // Drag-and-drop images: files from the desktop (compressed to data URLs) or an
  // image dragged from another browser tab (stored by its URL).
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const addImage = async (imageUrl: string, dx = 0, dy = 0) => {
        try {
          const { node } = await canvasApi.create(wsId, {
            type: 'image', content: '', imageUrl, x: pos.x + dx, y: pos.y + dy, color: 'plain',
          })
          patchCache((nds) => [...nds, node])
        } catch {
          toast.error('Could not add image')
        }
      }

      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        let i = 0
        for (const file of files) {
          try {
            const dataUrl = await compressImageFile(file)
            await addImage(dataUrl, i * 24, i * 24)
          } catch {
            toast.error(`Couldn’t read ${file.name}`)
          }
          i++
        }
        return
      }

      const url = imageUrlFromDataTransfer(e.dataTransfer)
      if (url) await addImage(url)
    },
    [screenToFlowPosition, wsId, patchCache]
  )

  const convertSelected = useCallback(() => {
    if (!selectedId) return
    // Read from the canonical cache, not a render closure — a just-edited node's
    // content is flushed to the cache on the textarea blur that this click causes.
    const cache = qc.getQueryData<{ nodes: CanvasNode[] }>(['canvas', wsId])
    const n = cache?.nodes.find((x) => x.id === selectedId)
    if (!n) return
    const content = (n.content || '').trim()
    const prefill =
      n.type === 'image'
        ? { whyImageUrl: n.imageUrl ?? '', whyText: content }
        : { whyText: content, title: content.split('\n')[0].slice(0, 80) }
    navigate('/app/architect', { state: { prefill } })
  }, [qc, wsId, selectedId, navigate])

  const selectedNode = nodes.find((n) => n.id === selectedId)

  return (
    <div
      ref={wrapRef}
      className="relative h-[100dvh] w-full"
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-3 z-20 rounded-2xl border-2 border-dashed border-accent/60 bg-accent/5" />
      )}
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
        onPaneClick={() => setSelectedId(null)}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.6, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        className="bg-bg"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="rgb(var(--color-border))" />
        <Controls showInteractive={false} className="!shadow-card" />

        {/* Toolbar */}
        <Panel position="top-left" className="!m-3">
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface/95 p-2 shadow-card backdrop-blur">
            <div className="px-2 pb-1 pt-0.5">
              <div className="flex items-center gap-1.5 text-text-3">
                <Sparkles size={13} />
                <span className="text-[10px] font-semibold uppercase tracking-widest">Vision Canvas</span>
              </div>
            </div>
            <ToolButton icon={StickyNote} label="Note" onClick={() => addNode('note')} />
            <ToolButton icon={Quote} label="Quote" onClick={() => addNode('quote')} />
            <ToolButton icon={ImageIcon} label="Image" onClick={() => addNode('image')} />

            <div className="mx-1 my-1 border-t border-border" />
            <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-0.5 text-text-3">
              <Feather size={12} />
              <span className="text-[10px] font-semibold uppercase tracking-widest">Reflect with AI</span>
            </div>
            {REFLECT_EXERCISES.map((ex) => (
              <ToolButton key={ex.key} icon={ex.icon} label={ex.label} onClick={() => setReflectExercise(ex.key)} />
            ))}
          </div>
        </Panel>

        {/* Synthesise */}
        <Panel position="top-right" className="!m-3">
          <button
            onClick={() => {
              const notes = collectNotes()
              if (notes.length === 0) { toast('Add a few notes first, then synthesise.', { icon: '🪶' }); return }
              setSynthNotes(notes)
            }}
            className="btn-gradient inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-card"
          >
            <Sparkles size={15} /> Synthesise my vision
          </button>
        </Panel>

        {/* Empty hint */}
        {nodes.length === 0 && (
          <Panel position="top-center" className="!mt-24">
            <div className="pointer-events-none max-w-xs rounded-2xl border border-dashed border-border bg-surface/90 p-5 text-center shadow-card">
              <p className="font-serif text-base text-text-1">Drop in the life you want</p>
              <p className="mt-1 text-sm text-text-2">
                Drag images straight onto the canvas, or add quotes and notes — anything that
                stirs you. Then convert any of it into a habit blueprint.
              </p>
            </div>
          </Panel>
        )}

        {/* Selection actions */}
        {selectedNode && (
          <Panel position="bottom-center" className="!mb-20 md:!mb-6">
            <div className="flex items-center gap-2 rounded-full border border-border bg-surface/95 p-1.5 pl-4 shadow-card-hover backdrop-blur">
              <span className="text-xs text-text-2">Selected</span>
              <button
                onClick={convertSelected}
                className="btn-gradient inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white"
              >
                <Hammer size={13} /> Convert to Habit Blueprint
              </button>
              <button
                onClick={deleteSelected}
                className="grid h-7 w-7 place-items-center rounded-full text-text-3 hover:bg-surface-2 hover:text-danger"
                aria-label="Delete node"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </Panel>
        )}
      </ReactFlow>

      <ReflectionChat
        open={reflectExercise !== null}
        exercise={reflectExercise}
        onClose={() => setReflectExercise(null)}
        onAddToCanvas={addReflectionNote}
      />

      <SynthesisPanel
        open={synthNotes !== null}
        notes={synthNotes ?? []}
        onClose={() => setSynthNotes(null)}
        onAddNote={(content) => createNote(content, 'plain')}
        onSendToArchitect={sendToArchitect}
      />
    </div>
  )
}

function ToolButton({ icon: Icon, label, onClick }: { icon: typeof StickyNote; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-text-2 hover:bg-surface-2 hover:text-text-1"
    >
      <Icon size={16} />
      {label}
    </button>
  )
}

export function VisionCanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
