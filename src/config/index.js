import 'dotenv/config';
import logger from '../utils/logger.js';

const requiredEnvVars = [
  'ATUALCARGO_URL',
  'ATUALCARGO_API_KEY',
  'ATUALCARGO_USERNAME',
  'ATUALCARGO_PASSWORD',
  'SANKHYA_URL',
  'SANKHYA_USER',
  'SANKHYA_PASSWORD',
  'WAIT_AFTER_LOGIN_MS',
  'WAIT_BETWEEN_CYCLES_MS',
  'WAIT_AFTER_ERROR_MS',
  'ATUALCARGO_POSITION_TIMEOUT_MS', 
];

// Validação
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    const errorMsg = `Variável de ambiente obrigatória ${varName} não definida.`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}

export const config = {
  atualcargo: {
    url: process.env.ATUALCARGO_URL,
    apiKey: process.env.ATUALCARGO_API_KEY,
    username: process.env.ATUALCARGO_USERNAME,
    password: process.env.ATUALCARGO_PASSWORD,
    timeout: Number(process.env.ATUALCARGO_POSITION_TIMEOUT_MS),
    // [NOVO] Adiciona o tempo de expiração do token (padrão: 5 minutos)
    tokenExpirationMs: Number(process.env.ATUALCARGO_TOKEN_EXPIRATION_MS) || 300000,
  },
  sankhya: {
    url: process.env.SANKHYA_URL,
    contingencyUrl: process.env.SANKHYA_CONTINGENCY_URL || null,
    username: process.env.SANKHYA_USER,
    password: process.env.SANKHYA_PASSWORD,
  },
  cycle: {
    waitAfterLoginMs: Number(process.env.WAIT_AFTER_LOGIN_MS),
    waitBetweenCyclesMs: Number(process.env.WAIT_BETWEEN_CYCLES_MS),
    waitAfterErrorMs: Number(process.env.WAIT_AFTER_ERROR_MS),
  },
};