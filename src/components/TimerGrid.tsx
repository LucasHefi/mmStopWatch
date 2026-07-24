import { useCallback, useMemo, useEffect } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, rectSwappingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence } from 'framer-motion'
import type { TimerInstance } from '../stores/timersStore'
import { useSessionStore } from '../stores/sessionStore'
import SecondaryTimerCard from './SecondaryTimerCard'
import TimerTableView from './TimerTableView'
import { LayoutList, LayoutGrid, Grid2X2, Grid3X3, Columns4 } from 'lucide-react'
import { useWindowWidth } from '../hooks/useWindowWidth'
import type { LayoutMode } from '../types/session'

const MIN_CARD_WIDTH = 375
const GAP = 16

const LAYOUT_COLUMNS: Record<LayoutMode, number> = {
  list: 1,
  'grid-1': 1,
  'grid-2': 2,
  'grid-3': 3,
  'grid-4': 4,
}

const LAYOUT_PRIORITY: LayoutMode[] = ['grid-4', 'grid-3', 'grid-2', 'grid-1', 'list']

const gridClasses: Record<string, string> = {
  'list': 'flex flex-col space-y-4',
  'grid-1': 'grid grid-cols-1 gap-4',
  'grid-2': 'grid grid-cols-2 gap-4',
  'grid-3': 'grid grid-cols-3 gap-4',
  'grid-4': 'grid grid-cols-4 gap-4',
}

interface TimerGridProps {
  timers: TimerInstance[]
  viewMode: 'cards' | 'table'
  layoutMode: LayoutMode
  onLayoutModeChange: (mode: LayoutMode) => void
  onViewModeChange: (mode: 'cards' | 'table') => void
}

function isLayoutFeasible(mode: LayoutMode, windowWidth: number): boolean {
  if (mode === 'list' || mode === 'grid-1') return true
  const cols = LAYOUT_COLUMNS[mode]
  return windowWidth >= cols * MIN_CARD_WIDTH + (cols - 1) * GAP
}

function getFeasibleLayouts(windowWidth: number): LayoutMode[] {
  return LAYOUT_PRIORITY.filter(mode => isLayoutFeasible(mode, windowWidth))
}

const layoutToggleIcons: Record<string, { icon: React.ElementType; title: string }> = {
  'list': { icon: LayoutList, title: 'List' },
  'grid-1': { icon: LayoutGrid, title: '1 column' },
  'grid-2': { icon: Grid2X2, title: '2 columns' },
  'grid-3': { icon: Grid3X3, title: '3 columns' },
  'grid-4': { icon: Columns4, title: '4 columns' },
}

export default function TimerGrid({ timers, viewMode, layoutMode, onLayoutModeChange, onViewModeChange }: TimerGridProps) {
  const setMDConfig = useSessionStore(s => s.setMDConfig)
  const mdConfig = useSessionStore(s => s.mdConfig)
  const windowWidth = useWindowWidth()

  const feasibleLayouts = useMemo(() => getFeasibleLayouts(windowWidth), [windowWidth])

  useEffect(() => {
    if (!feasibleLayouts.includes(layoutMode)) {
      onLayoutModeChange(feasibleLayouts[0])
    }
  }, [windowWidth, layoutMode, feasibleLayouts, onLayoutModeChange])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const itemIds = timers.map(t => t.notePath || t.id)
    const oldIndex = itemIds.indexOf(String(active.id))
    const newIndex = itemIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = [...itemIds]
    newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, itemIds[oldIndex])

    const cfg = { ...mdConfig, timerLayout: { ...(mdConfig.timerLayout || { mode: layoutMode, order: [] }), order: newOrder } }
    setMDConfig(cfg)
  }, [timers, mdConfig, layoutMode, setMDConfig])

  const sortableIds = timers.map(t => t.notePath || t.id)

  return (
    <div className="w-full max-w-full relative z-10">
      <div className="flex items-center justify-end gap-1 mb-3">
        <button
          onClick={() => onViewModeChange('table')}
          className={`p-1.5 rounded text-xs transition-colors ${viewMode === 'table' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          title="Table view"
        >
          <LayoutList size={14} />
        </button>
        <button
          onClick={() => onViewModeChange('cards')}
          className={`p-1.5 rounded text-xs transition-colors ${viewMode === 'cards' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          title="Card view"
        >
          <Grid2X2 size={14} />
        </button>
        {viewMode === 'cards' && (
          <>
            <span className="text-zinc-700 mx-1">|</span>
            {feasibleLayouts.map(mode => {
              const { icon: Icon, title } = layoutToggleIcons[mode]
              return (
                <button
                  key={mode}
                  onClick={() => onLayoutModeChange(mode)}
                  className={`p-1.5 rounded text-xs transition-colors ${layoutMode === mode ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                  title={title}
                >
                  <Icon size={14} />
                </button>
              )
            })}
          </>
        )}
      </div>

      {viewMode === 'table' ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="py-2 pr-3 w-8"></th>
                  <th className="py-2 pr-3 text-left font-medium">Name</th>
                  <th className="py-2 pr-3 text-left font-medium">Time</th>
                  <th className="py-2 pr-3 text-left font-medium">Progress</th>
                  <th className="py-2 pr-3 text-left font-medium">Estimate</th>
                  <th className="py-2 pr-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <tbody>
                  <AnimatePresence>
                    {timers.map(timer => (
                      <TimerTableView key={timer.id} timer={timer} dragHandle />
                    ))}
                  </AnimatePresence>
                </tbody>
              </SortableContext>
            </table>
          </div>
        </DndContext>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={layoutMode === 'list' || layoutMode === 'grid-1' ? verticalListSortingStrategy : rectSwappingStrategy}>
            <div className={gridClasses[layoutMode]}>
              <AnimatePresence>
                {timers.map(timer => (
                  <SecondaryTimerCard key={timer.id} timer={timer} />
                ))}
              </AnimatePresence>
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
