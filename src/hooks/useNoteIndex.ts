import { useEffect, useMemo, useRef, useState } from 'react'
import { noteIndex } from '../services/noteIndex'
import type { MDConfig, Session } from '../types/session'

export interface IndexedNotesState {
  sessions: Session[]
  loading: boolean
  error: string | null
  revision: number
}

export function useNoteIndex(config: MDConfig): IndexedNotesState {
  const [state, setState] = useState<IndexedNotesState>({ sessions: [], loading: false, error: null, revision: 0 })
  const generation = useRef(0)
  const options = useMemo(() => ({
    folder: config.notesFolder || '',
    frontmatterKey: config.frontmatterKey,
    timeEstimateKey: config.timeEstimateKey,
    statsFieldKeys: config.statsFieldKeys,
  }), [config.notesFolder, config.frontmatterKey, config.timeEstimateKey, config.statsFieldKeys])

  useEffect(() => {
    if (!options.folder) {
      setState({ sessions: [], loading: false, error: null, revision: noteIndex.getRevision() })
      return
    }
    const request = ++generation.current
    setState(previous => ({ ...previous, loading: true, error: null }))
    void noteIndex.load(options).then(sessions => {
      if (request !== generation.current) return
      setState({ sessions, loading: false, error: null, revision: noteIndex.getRevision() })
    }).catch(error => {
      if (request !== generation.current) return
      setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }))
    })
  }, [options])

  return state
}
