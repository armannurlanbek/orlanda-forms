// OWNED BY: Wave 2 — Agent C.
//   GET  /api/uploads/logo/:id   PUBLIC — serves a validated raster logo so the
//                                public form can render it via <img>. (§16.8)
//   POST /api/uploads/logo       builder-auth + csrf; multipart raster image
//                                upload -> { logoUrl } for Form.theme. (§16.8/§20)
//
// IMPORTANT: the public GET is registered BEFORE requireAuth so the unauth'd
// public form can load the logo. Logos are validated raster images that are
// MEANT to display inline (distinct from untrusted attachments, which this app
// never serves) — we serve them with the correct image Content-Type and
// X-Content-Type-Options: nosniff.
import { Router } from 'express';
import multer from 'multer';
import { UPLOAD_LIMITS } from '@orlanda/shared';
import { csrfProtect, requireAuth } from '../auth/middleware';
import { asyncHandler, badRequest, notFound } from '../http/errors';
import { validateUpload } from '../files/validate';
import { prisma } from '../db/prisma';

export const uploadsRouter = Router();

// In-memory single-file upload, hard-capped at 10 MB (§16.2 per-file limit).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.maxFileBytes, files: 1 },
});

// ── PUBLIC: serve a logo (no auth) ───────────────────────────────────────────
// Registered first so requireAuth (below) never gates it.
uploadsRouter.get(
  '/logo/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.kind !== 'logo') throw notFound('Logo not found.');

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(Buffer.from(asset.bytes));
  }),
);

// ── AUTH boundary: everything below requires a builder session ───────────────
uploadsRouter.use(requireAuth);

// POST /api/uploads/logo — builder-auth + csrf; raster image only (§16.8).
uploadsRouter.post(
  '/logo',
  csrfProtect,
  upload.single('logo'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) throw badRequest('No logo file provided.');

    // Magic-byte + extension allowlist (raster only; SVG rejected by the list).
    const result = validateUpload(
      file.buffer,
      file.originalname,
      UPLOAD_LIMITS.logoAllowedExtensions,
    );
    if (!result.ok) throw badRequest(result.reason);

    const asset = await prisma.asset.create({
      data: {
        kind: 'logo',
        mimeType: result.mime,
        sizeBytes: file.buffer.length,
        bytes: file.buffer,
        createdById: req.user?.id ?? null,
      },
    });

    res.status(201).json({ logoUrl: `/api/uploads/logo/${asset.id}` });
  }),
);
