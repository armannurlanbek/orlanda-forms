// React Query hooks for Monday boards + the live board schema (§17.2). The
// schema query is cached; a manual Refresh action invalidates and forces a
// server-side cache refresh (POST .../schema/refresh).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MondayBoardSchema } from '@orlanda/shared';
import { api } from '../../lib/api';

export interface BoardRef {
  id: string;
  name: string;
}

export function useBoards() {
  return useQuery({
    queryKey: ['monday', 'boards'],
    queryFn: () => api.get<BoardRef[]>('/api/monday/boards'),
    staleTime: 5 * 60_000,
  });
}

export function useBoardSchema(boardId: string | null) {
  return useQuery({
    queryKey: ['monday', 'schema', boardId],
    queryFn: () => api.get<MondayBoardSchema>(`/api/monday/boards/${boardId}/schema`),
    enabled: !!boardId,
    staleTime: 10 * 60_000,
  });
}

export function useRefreshBoardSchema(boardId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<MondayBoardSchema>(`/api/monday/boards/${boardId}/schema/refresh`),
    onSuccess: (schema) => {
      // Seed the cache with the fresh result and invalidate so consumers refetch.
      qc.setQueryData(['monday', 'schema', boardId], schema);
      qc.invalidateQueries({ queryKey: ['monday', 'schema', boardId] });
    },
  });
}

/**
 * Best-effort parse of status/dropdown labels out of a column's verbatim
 * settings_str. Returns [] for column types/shapes we don't recognize. Used to
 * show reference labels in the AI panel and to populate the AI allowlist.
 */
export function parseColumnLabels(settingsStr: string): string[] {
  if (!settingsStr) return [];
  try {
    const parsed = JSON.parse(settingsStr) as Record<string, unknown>;
    const labels = parsed.labels;
    if (Array.isArray(labels)) {
      // dropdown shape: labels: [{ id, name }]
      return labels
        .map((l) => (l && typeof l === 'object' ? String((l as Record<string, unknown>).name ?? '') : ''))
        .filter(Boolean);
    }
    if (labels && typeof labels === 'object') {
      // status shape: labels: { "0": "Done", "1": "Working on it" }
      return Object.values(labels as Record<string, unknown>)
        .map((v) => String(v ?? ''))
        .filter(Boolean);
    }
  } catch {
    /* not JSON / unknown shape */
  }
  return [];
}

/**
 * Best-effort parse of the FIRST linked board id out of a board-relation/connect
 * column's verbatim settings_str (shape: `{ "boardIds": [123, 456], ... }`).
 * The board id identifies which board the answer is matched against to link an
 * item (and thereby populate any mirror that reflects this column). Returns
 * undefined when the column has no usable boardIds. Ids are normalized to string.
 */
export function parseLinkedBoardId(settingsStr: string): string | undefined {
  if (!settingsStr) return undefined;
  try {
    const parsed = JSON.parse(settingsStr) as Record<string, unknown>;
    const boardIds = parsed.boardIds;
    if (Array.isArray(boardIds) && boardIds.length > 0) {
      const first = boardIds[0];
      if (typeof first === 'string' || typeof first === 'number') {
        const id = String(first);
        return id ? id : undefined;
      }
    }
  } catch {
    /* not JSON / unknown shape */
  }
  return undefined;
}
