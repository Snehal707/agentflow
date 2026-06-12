import { Router } from 'express';
import { authMiddleware } from '../lib/auth';
import {
  telegramGenerateCodeHandler,
  telegramStatusHandler,
  telegramUnlinkHandler,
} from '../lib/telegram-settings-handlers';

const router = Router();

router.post('/generate-code', authMiddleware, telegramGenerateCodeHandler);
router.post('/unlink', authMiddleware, telegramUnlinkHandler);
router.get('/status', authMiddleware, telegramStatusHandler);
router.get('/link-status', authMiddleware, telegramStatusHandler);

export default router;
