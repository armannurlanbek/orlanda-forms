import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /api/public/forms/:slug must expose the render-safe multilingual fields
// (defaultLang, languages, translations — form + per-question) alongside the
// existing whitelist (§16.6). We mock prisma so this is a pure-logic check with
// no DB, and stub the worker nudge (unrelated to this endpoint).
const { formFindFirstMock } = vi.hoisted(() => ({
  formFindFirstMock: vi.fn(),
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    form: { findFirst: formFindFirstMock },
  },
}));

vi.mock('../worker', () => ({ nudge: vi.fn() }));

import { publicRouter } from './routes';
import { errorHandler } from '../http/errors';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicRouter);
  app.use(errorHandler);
  return app;
}

describe('GET /api/public/forms/:slug — i18n fields', () => {
  beforeEach(() => {
    formFindFirstMock.mockReset();
  });

  it('exposes languages, defaultLang and translations in the public DTO', async () => {
    formFindFirstMock.mockResolvedValue({
      slug: 'my-form',
      defaultLang: 'en',
      languages: ['en', 'ar'],
      translations: { ar: { title: 'عنوان' } },
      title: 'My Form',
      description: null,
      welcomeText: null,
      welcomeButtonLabel: 'Start',
      thankYouText: null,
      privacyNotice: null,
      theme: null,
      questions: [
        {
          id: 'q1',
          order: 0,
          type: 'text',
          label: 'Name',
          helpText: null,
          required: true,
          options: null,
          translations: { ar: { label: 'الاسم' } },
        },
      ],
    });

    const res = await request(makeApp()).get('/api/public/forms/my-form');

    expect(res.status).toBe(200);
    expect(res.body.defaultLang).toBe('en');
    expect(res.body.languages).toEqual(['en', 'ar']);
    expect(res.body.translations.ar.title).toBe('عنوان');
    expect(res.body.questions[0].translations.ar.label).toBe('الاسم');
  });

  it('falls back languages to [defaultLang] when the form has no languages set', async () => {
    formFindFirstMock.mockResolvedValue({
      slug: 'single-lang',
      defaultLang: 'en',
      languages: [],
      translations: null,
      title: 'Single Lang Form',
      description: null,
      welcomeText: null,
      welcomeButtonLabel: 'Start',
      thankYouText: null,
      privacyNotice: null,
      theme: null,
      questions: [],
    });

    const res = await request(makeApp()).get('/api/public/forms/single-lang');

    expect(res.status).toBe(200);
    expect(res.body.languages).toEqual(['en']);
    expect(res.body.translations).toBeNull();
  });
});
