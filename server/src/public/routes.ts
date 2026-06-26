// Public, unauthenticated routes (§16.6 / §13.1 / §16.1).
//   GET  /api/public/forms/:slug          render-safe DTO ONLY; 404 if unpublished
//   POST /api/public/forms/:slug/submit   multipart submit; rate-limited; generic success
import { Router } from 'express';
import multer from 'multer';
import {
  DEFAULT_THEME,
  UPLOAD_LIMITS,
  normalizeTheme,
  type PublicFormDTO,
  type PublicQuestionDTO,
  type QuestionConfig,
} from '@orlanda/shared';
import { prisma } from '../db/prisma';
import { asyncHandler, notFound } from '../http/errors';
import { submitGlobalLimiter, submitPerHourLimiter, submitPerMinuteLimiter } from '../http/rateLimit';
import { getPublishedForm, handleSubmit } from './submit';
import { nudge } from '../worker';

export const publicRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.maxFileBytes, files: UPLOAD_LIMITS.maxFilesPerSubmission },
});

// GET /api/public/forms/:slug — render-safe DTO whitelist only (§16.6).
publicRouter.get(
  '/forms/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug);
    const form = await prisma.form.findFirst({
      where: { slug, status: 'published', deletedAt: null },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!form) throw notFound('Form not found.');

    const questions: PublicQuestionDTO[] = form.questions.map((q) => ({
      id: q.id,
      order: q.order,
      type: q.type,
      label: q.label,
      helpText: q.helpText,
      required: q.required,
      options: (q.options as QuestionConfig | null) ?? null,
    }));

    // Re-validate the stored theme at the public boundary (§16.8): only validated
    // colors ever reach the browser. If the stored theme is somehow invalid (bad
    // legacy row, manual DB edit), fall back to the default theme rather than
    // failing the public request.
    let theme;
    try {
      theme = normalizeTheme(form.theme);
    } catch {
      theme = DEFAULT_THEME;
    }

    const dto: PublicFormDTO = {
      slug: form.slug,
      title: form.title,
      description: form.description,
      welcomeText: form.welcomeText,
      welcomeButtonLabel: form.welcomeButtonLabel,
      thankYouText: form.thankYouText,
      privacyNotice: form.privacyNotice,
      theme,
      questions,
    };
    res.json(dto);
  }),
);

// POST /api/public/forms/:slug/submit — multipart; abuse controls run as
// middleware BEFORE the body is parsed (§16.1). Always returns a generic success.
publicRouter.post(
  '/forms/:slug/submit',
  submitGlobalLimiter,
  submitPerMinuteLimiter,
  submitPerHourLimiter,
  upload.any(),
  asyncHandler(async (req, res) => {
    const form = await getPublishedForm(String(req.params.slug));
    const outcome = await handleSubmit(req, form);
    if (outcome.created) nudge();
    res.json({ ok: true });
  }),
);
