// OWNED BY: Wave 2 — Agent C (Builder REST API).
// Implements §9/§15/§20 forms endpoints:
//   GET    /api/forms                     list (FormSummary[])           auth
//   POST   /api/forms                     create draft -> FormDetail     auth+csrf
//   GET    /api/forms/:id                 FormDetail                     auth
//   PUT    /api/forms/:id                 full-form save (§17.1)         auth+csrf
//   DELETE /api/forms/:id                 soft-delete (§15.3.5)          auth+csrf
//   POST   /api/forms/:id/publish         publish preconditions (§15.3.4) auth+csrf
//   POST   /api/forms/:id/preview-mapping dry-run mapping, no write (§18.9) auth+csrf
//   GET    /api/forms/:id/submissions     SubmissionRow[] (internal)     auth
//
// Builders are ORG-WIDE trusted (§16.5): any authenticated builder may act on
// any form. Missing/soft-deleted forms return 404 (never 403) to avoid
// enumeration. State-changing routes also require csrfProtect (§16.4).
import { Router } from 'express';
import { csrfProtect, requireAuth } from '../auth/middleware';
import { asyncHandler } from '../http/errors';
import {
  createForm,
  getFormDetail,
  listForms,
  listSubmissions,
  previewMapping,
  publishForm,
  saveForm,
  softDeleteForm,
} from './service';

export const formsRouter = Router();
formsRouter.use(requireAuth);

// GET /api/forms — dashboard list (excludes soft-deleted).
formsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await listForms());
  }),
);

// POST /api/forms — create a draft with a unique slug; returns FormDetail.
formsRouter.post(
  '/',
  csrfProtect,
  asyncHandler(async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
    const detail = await createForm(req.user!.id, title);
    res.status(201).json(detail);
  }),
);

// GET /api/forms/:id — full form detail with ordered questions.
formsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getFormDetail(String(req.params.id)));
  }),
);

// PUT /api/forms/:id — full-form save incl. nested questions (§17.1).
formsRouter.put(
  '/:id',
  csrfProtect,
  asyncHandler(async (req, res) => {
    res.json(await saveForm(String(req.params.id), req.body));
  }),
);

// DELETE /api/forms/:id — soft-delete (§15.3.5).
formsRouter.delete(
  '/:id',
  csrfProtect,
  asyncHandler(async (req, res) => {
    await softDeleteForm(String(req.params.id));
    res.status(200).json({ ok: true });
  }),
);

// POST /api/forms/:id/publish — enforce publish preconditions (§15.3.4).
formsRouter.post(
  '/:id/publish',
  csrfProtect,
  asyncHandler(async (req, res) => {
    res.json(await publishForm(String(req.params.id)));
  }),
);

// POST /api/forms/:id/preview-mapping — dry-run mapping, no Monday write (§18.9).
formsRouter.post(
  '/:id/preview-mapping',
  csrfProtect,
  asyncHandler(async (req, res) => {
    const result = await previewMapping(String(req.params.id), req.body?.sampleAnswers);
    res.json(result);
  }),
);

// GET /api/forms/:id/submissions — internal submissions view (full data).
formsRouter.get(
  '/:id/submissions',
  asyncHandler(async (req, res) => {
    res.json(await listSubmissions(String(req.params.id)));
  }),
);
