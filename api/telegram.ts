import { Router } from 'express';
import { authMiddleware } from '../lib/auth';
import {
  telegramGenerateCodeHandler,
  telegramStatusHandler,
} from '../lib/telegram-settings-handlers';

const router = Router();

router.post('/generate-code', authMiddleware, telegramGenerateCodeHandler);
router.get('/link-status', authMiddleware, telegramStatusHandler);

export default router;
