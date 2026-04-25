import { Router } from 'express';
import { authMiddleware } from '../lib/auth';
import {
  telegramGenerateCodeHandler,
  telegramStatusHandler,
  telegramUnlinkHandler,
} from '../lib/telegram-settings-handlers';

const router = Router();

router.post('/telegram/generate-code', authMiddleware, telegramGenerateCodeHandler);
router.post('/telegram/unlink', authMiddleware, telegramUnlinkHandler);
router.get('/telegram/status', authMiddleware, telegramStatusHandler);

export default router;
