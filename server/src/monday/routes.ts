// OWNED BY: Wave 2 — Agent C (uses the Monday service from Agent A).
//   GET  /api/monday/boards                    list boards
//   GET  /api/monday/boards/:id/schema         schema via cache (§11/§15.2)
//   POST /api/monday/boards/:id/schema/refresh forced refresh (§20)
// requireAuth on all; refresh + reads are privileged builder actions (§16.5).
import { Router } from 'express';
import { requireAuth } from '../auth/middleware';
import { asyncHandler, badRequest } from '../http/errors';
import { getBoardSchema, invalidateBoardSchema, listBoards } from './service';

export const mondayRouter = Router();
mondayRouter.use(requireAuth);

// GET /api/monday/boards — list boards visible to the server token.
mondayRouter.get(
  '/boards',
  asyncHandler(async (_req, res) => {
    const boards = await listBoards();
    res.json(boards);
  }),
);

// GET /api/monday/boards/:id/schema — board schema via the BoardSchemaCache (§15.2).
mondayRouter.get(
  '/boards/:id/schema',
  asyncHandler(async (req, res) => {
    const boardId = String(req.params.id ?? '').trim();
    if (!boardId) throw badRequest('Missing board id');
    const schema = await getBoardSchema(boardId);
    res.json(schema);
  }),
);

// POST /api/monday/boards/:id/schema/refresh — force a cache refresh (§20).
mondayRouter.post(
  '/boards/:id/schema/refresh',
  asyncHandler(async (req, res) => {
    const boardId = String(req.params.id ?? '').trim();
    if (!boardId) throw badRequest('Missing board id');
    // Purge first so a concurrent reader cannot serve the stale row (§15.2.2),
    // then force a fresh fetch.
    await invalidateBoardSchema(boardId);
    const schema = await getBoardSchema(boardId, { forceRefresh: true });
    res.json(schema);
  }),
);
