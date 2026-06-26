// Central API router. Each sub-router is owned by one module/agent (see file
// headers) so parallel work never edits this file beyond mounting.
import { Router } from 'express';
import { authRouter } from '../auth/routes';
import { formsRouter } from '../forms/routes';
import { mondayRouter } from '../monday/routes';
import { uploadsRouter } from '../uploads/routes';
import { submissionsRouter } from '../submissions/routes';
import { publicRouter } from '../public/routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/forms', formsRouter);
apiRouter.use('/monday', mondayRouter);
apiRouter.use('/uploads', uploadsRouter);
apiRouter.use('/submissions', submissionsRouter);
apiRouter.use('/public', publicRouter);
