-- Multilingual forms: display-only translation columns.
ALTER TABLE "Form" ADD COLUMN "defaultLang" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Form" ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Form" ADD COLUMN "translations" JSONB;
ALTER TABLE "Question" ADD COLUMN "translations" JSONB;
