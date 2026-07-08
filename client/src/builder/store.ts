// Zustand builder store (§17.2). Holds the in-progress form snapshot + the
// ordered question list + a dirty flag + the current selection. Server data
// (FormDetail) hydrates the store on load; Save serializes the snapshot into a
// SaveFormInput. The client owns array order; the server derives `order` from
// index (§17.1) so we never store/send an `order` field from edits.
import { create } from 'zustand';
import type {
  AllowlistColumn,
  FormDetail,
  MappingMode,
  QuestionConfig,
  QuestionType,
  SaveFormInput,
  Theme,
} from '@orlanda/shared';
import { DEFAULT_THEME, slugError } from '@orlanda/shared';

// A question as held in the store. `key` is a stable client-only id used as the
// dnd-kit / React key for both saved and brand-new questions. `serverId` is the
// persisted id (undefined for not-yet-saved questions) — only that is sent up.
export interface DraftQuestion {
  key: string;
  serverId?: string;
  type: QuestionType;
  label: string;
  helpText: string;
  required: boolean;
  options: QuestionConfig;
  // For board-relation/connect targets, `link.boardId` carries the board the
  // column links to (parsed from the column's settings_str) so the server-side
  // Direct resolver knows which board to match the answer against (§ linked-items).
  directMapping: { columnId: string; columnType: string; link?: { boardId: string } } | null;
}

export interface BuilderFormState {
  title: string;
  /** Editable public-link slug (the `/{slug}` of the public URL). */
  slug: string;
  description: string;
  boardId: string | null;
  mappingMode: MappingMode;
  aiPrompt: string;
  aiAllowedColumns: AllowlistColumn[];
  welcomeText: string;
  welcomeButtonLabel: string;
  thankYouText: string;
  privacyNotice: string;
  theme: Theme;
  dailySubmissionCap: number;
}

interface BuilderStore {
  formId: string | null;
  status: 'draft' | 'published' | null;
  slug: string | null;
  loaded: boolean;
  dirty: boolean;
  selectedKey: string | null;
  form: BuilderFormState;
  questions: DraftQuestion[];

  hydrate: (detail: FormDetail) => void;
  reset: () => void;

  setField: <K extends keyof BuilderFormState>(key: K, value: BuilderFormState[K]) => void;
  setMappingMode: (mode: MappingMode) => void;
  setTheme: (theme: Theme) => void;

  addQuestion: (type: QuestionType) => void;
  updateQuestion: (key: string, patch: Partial<Omit<DraftQuestion, 'key'>>) => void;
  removeQuestion: (key: string) => void;
  reorder: (fromKey: string, toKey: string) => void;
  select: (key: string | null) => void;

  toSaveInput: () => SaveFormInput;
  markSaved: (detail: FormDetail) => void;
}

let keySeq = 0;
function newKey(): string {
  keySeq += 1;
  return `q_${Date.now().toString(36)}_${keySeq}`;
}

function defaultLabelFor(type: QuestionType): string {
  switch (type) {
    case 'text':
      return 'Short answer';
    case 'long_text':
      return 'Long answer';
    case 'number':
      return 'Number';
    case 'single_select':
      return 'Choose one';
    case 'multi_select':
      return 'Choose any';
    case 'attachment':
      return 'Upload file';
    default:
      return 'Question';
  }
}

const EMPTY_FORM: BuilderFormState = {
  title: '',
  slug: '',
  description: '',
  boardId: null,
  mappingMode: 'direct',
  aiPrompt: '',
  aiAllowedColumns: [],
  welcomeText: '',
  welcomeButtonLabel: 'Start',
  thankYouText: '',
  privacyNotice: '',
  theme: DEFAULT_THEME,
  dailySubmissionCap: 0,
};

// Narrow the loosely-typed `directMapping.link` (the DTO field is `unknown`) into
// the store's `{ link: { boardId } }` shape, dropping anything malformed.
function parseDirectMappingLink(link: unknown): { link?: { boardId: string } } {
  if (link && typeof link === 'object') {
    const boardId = (link as Record<string, unknown>).boardId;
    if (typeof boardId === 'string' && boardId) return { link: { boardId } };
  }
  return {};
}

function detailToState(detail: FormDetail): { form: BuilderFormState; questions: DraftQuestion[] } {
  const form: BuilderFormState = {
    title: detail.title ?? '',
    slug: detail.slug ?? '',
    description: detail.description ?? '',
    boardId: detail.boardId ?? null,
    mappingMode: detail.mappingMode,
    aiPrompt: detail.aiPrompt ?? '',
    aiAllowedColumns: detail.aiAllowedColumns ?? [],
    welcomeText: detail.welcomeText ?? '',
    welcomeButtonLabel: detail.welcomeButtonLabel || 'Start',
    thankYouText: detail.thankYouText ?? '',
    privacyNotice: detail.privacyNotice ?? '',
    theme: detail.theme ?? DEFAULT_THEME,
    dailySubmissionCap: detail.dailySubmissionCap ?? 0,
  };
  const questions: DraftQuestion[] = [...detail.questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => ({
      key: newKey(),
      serverId: q.id,
      type: q.type,
      label: q.label ?? '',
      helpText: q.helpText ?? '',
      required: q.required,
      options: q.options ?? {},
      directMapping:
        q.directMapping && typeof q.directMapping.columnId === 'string'
          ? {
              columnId: q.directMapping.columnId,
              columnType: String(q.directMapping.columnType ?? ''),
              ...parseDirectMappingLink(q.directMapping.link),
            }
          : null,
    }));
  return { form, questions };
}

export const useBuilderStore = create<BuilderStore>((set, get) => ({
  formId: null,
  status: null,
  slug: null,
  loaded: false,
  dirty: false,
  selectedKey: null,
  form: EMPTY_FORM,
  questions: [],

  hydrate: (detail) => {
    const { form, questions } = detailToState(detail);
    set({
      formId: detail.id,
      status: detail.status,
      slug: detail.slug,
      loaded: true,
      dirty: false,
      selectedKey: questions[0]?.key ?? null,
      form,
      questions,
    });
  },

  reset: () =>
    set({
      formId: null,
      status: null,
      slug: null,
      loaded: false,
      dirty: false,
      selectedKey: null,
      form: EMPTY_FORM,
      questions: [],
    }),

  setField: (key, value) =>
    set((s) => ({ form: { ...s.form, [key]: value }, dirty: true })),

  setMappingMode: (mode) => set((s) => ({ form: { ...s.form, mappingMode: mode }, dirty: true })),

  setTheme: (theme) => set((s) => ({ form: { ...s.form, theme }, dirty: true })),

  addQuestion: (type) => {
    const q: DraftQuestion = {
      key: newKey(),
      type,
      label: defaultLabelFor(type),
      helpText: '',
      required: false,
      options:
        type === 'single_select' || type === 'multi_select' ? { options: ['Option 1', 'Option 2'] } : {},
      directMapping: null,
    };
    set((s) => ({ questions: [...s.questions, q], dirty: true, selectedKey: q.key }));
  },

  updateQuestion: (key, patch) =>
    set((s) => ({
      questions: s.questions.map((q) => (q.key === key ? { ...q, ...patch } : q)),
      dirty: true,
    })),

  removeQuestion: (key) =>
    set((s) => {
      const questions = s.questions.filter((q) => q.key !== key);
      const selectedKey = s.selectedKey === key ? (questions[0]?.key ?? null) : s.selectedKey;
      return { questions, selectedKey, dirty: true };
    }),

  reorder: (fromKey, toKey) =>
    set((s) => {
      const from = s.questions.findIndex((q) => q.key === fromKey);
      const to = s.questions.findIndex((q) => q.key === toKey);
      if (from === -1 || to === -1 || from === to) return s;
      const next = [...s.questions];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { questions: next, dirty: true };
    }),

  select: (key) => set({ selectedKey: key }),

  toSaveInput: () => {
    const { form, questions } = get();
    // Only send the slug when it is non-empty AND valid, so a mistyped slug can
    // never 400 the whole save and lose the builder's other edits (Finding #2).
    // An empty field is coerced to undefined → the server keeps the current slug
    // (Finding #7). The inline SettingsPanel error still forces the user to fix an
    // invalid slug for the change to take effect.
    const slugValid = form.slug && slugError(form.slug) === null;
    return {
      title: form.title,
      slug: slugValid ? form.slug : undefined,
      description: form.description || null,
      boardId: form.boardId,
      mappingMode: form.mappingMode,
      aiPrompt: form.mappingMode === 'ai' ? form.aiPrompt || null : null,
      aiAllowedColumns: form.mappingMode === 'ai' ? form.aiAllowedColumns : [],
      welcomeText: form.welcomeText || null,
      welcomeButtonLabel: form.welcomeButtonLabel || 'Start',
      thankYouText: form.thankYouText || null,
      privacyNotice: form.privacyNotice || null,
      theme: form.theme,
      dailySubmissionCap: form.dailySubmissionCap,
      // Complete ordered array. `order` is intentionally NOT sent (§17.1).
      questions: questions.map((q) => ({
        id: q.serverId, // absent => create
        type: q.type,
        label: q.label,
        helpText: q.helpText || null,
        required: q.required,
        options: q.options,
        // Files are always uploaded via a deterministic file-column mapping, never
        // by the AI (§12.2). So in AI mode we still persist the directMapping for
        // attachment questions (their File column); every other question is
        // AI-mapped and carries no directMapping.
        directMapping:
          form.mappingMode === 'direct' || q.type === 'attachment' ? q.directMapping : null,
      })),
    };
  },

  // After a successful PUT the server returns canonical ids/order; re-key while
  // preserving the current selection by index so the UI doesn't jump.
  markSaved: (detail) => {
    const prevSelectedIndex = get().questions.findIndex((q) => q.key === get().selectedKey);
    const { form, questions } = detailToState(detail);
    set({
      formId: detail.id,
      status: detail.status,
      slug: detail.slug,
      loaded: true,
      dirty: false,
      form,
      questions,
      selectedKey: prevSelectedIndex >= 0 ? questions[prevSelectedIndex]?.key ?? null : (questions[0]?.key ?? null),
    });
  },
}));
