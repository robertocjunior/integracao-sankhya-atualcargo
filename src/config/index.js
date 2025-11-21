import 'dotenv/config';
import logger from '../utils/logger.js';
import { jobsConfig } from './jobs.js'; // CORREÇÃO: Importa jobsConfig do arquivo jobs.js

// Validação de variáveis essenciais
const requiredEnvVars = [
  'SANKHYA_URL',
  'SANKHYA_USER',
  'SANKHYA_PASSWORD',
  'JOB_RETRY_DELAY_MS',
  'REQUEST_TIMEOUT_MS',
];

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    const errorMsg = `Variável de ambiente obrigatória ${varName} não definida.`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}

// Configurações Globais
export const appConfig = {
  logLevel: process.env.LOG_LEVEL || 'info',
  timeout: parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 120000,
  sankhyaRetryLimit: parseInt(process.env.SANKHYA_RETRY_LIMIT_BEFORE_SWAP, 10) || 2,
  jobRetryDelayMs: parseInt(process.env.JOB_RETRY_DELAY_MS, 10) || 60000,
  monitorPort: parseInt(process.env.MONITOR_PORT, 10) || 9222, 
};

// Configuração do Sankhya
export const sankhyaConfig = {
  url: process.env.SANKHYA_URL,
  contingencyUrl: process.env.SANKHYA_CONTINGENCY_URL || null,
  username: process.env.SANKHYA_USER,
  password: process.env.SANKHYA_PASSWORD,
  iscaDatasetId: process.env.SANKHYA_ISCA_DATASET_ID || '02S',
};

// CORREÇÃO: Exporta jobsConfig importado de jobs.js
export { jobsConfig };